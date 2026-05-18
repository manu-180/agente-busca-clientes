import { ResultadoBusquedaLead } from '@/types'
import { PlacesKey, getConfiguredPlacesKeys } from './keys'
import { annotateKeyError, consumeQuota, exhaustKeyForMonth, pickAvailableKey } from './quota'

interface GooglePlace {
  displayName?: { text?: string }
  formattedAddress?: string
  nationalPhoneNumber?: string
  internationalPhoneNumber?: string
  websiteUri?: string
  rating?: number
  userRatingCount?: number
  googleMapsUri?: string
}

const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText'

// Campos que dispararán el SKU "Text Search Enterprise" ($35/1000, free tier
// 1000/mes). websiteUri es Enterprise, así que el resto de campos Pro viajan
// gratis dentro de la misma llamada.
const FIELD_MASK = [
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.googleMapsUri',
  'places.types',
].join(',')

function normalizarTelefono(telefono: string | null | undefined): string {
  if (!telefono) return ''
  return telefono.replace(/\D/g, '')
}

export class PlacesNoKeysError extends Error {
  constructor() {
    super('No hay GOOGLE_PLACES_API_KEY configurada.')
    this.name = 'PlacesNoKeysError'
  }
}

export class PlacesAllKeysExhaustedError extends Error {
  constructor(public readonly totalKeys: number) {
    super(`Todas las API keys de Google Places (${totalKeys}) quemaron su cuota mensual gratuita.`)
    this.name = 'PlacesAllKeysExhaustedError'
  }
}

export interface PlacesSearchOk {
  ok: true
  resultados: ResultadoBusquedaLead[]
  key_label: string
  used: number
  quota: number
}

async function callPlacesApi(
  rubro: string,
  zona: string,
  key: PlacesKey,
  signal?: AbortSignal,
): Promise<{ status: number; bodyText: string }> {
  const res = await fetch(PLACES_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key.value,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: `${rubro} en ${zona}`,
      languageCode: 'es',
      maxResultCount: 20,
    }),
    cache: 'no-store',
    signal,
  })
  const bodyText = await res.text()
  return { status: res.status, bodyText }
}

function parseResultados(rubro: string, bodyText: string): ResultadoBusquedaLead[] {
  let parsed: { places?: GooglePlace[] }
  try {
    parsed = JSON.parse(bodyText) as { places?: GooglePlace[] }
  } catch {
    return []
  }
  const places: GooglePlace[] = Array.isArray(parsed?.places) ? parsed.places : []

  const resultados: ResultadoBusquedaLead[] = []
  const vistos = new Set<string>()

  for (const place of places) {
    const telefonoRaw = place.internationalPhoneNumber || place.nationalPhoneNumber || ''
    const telefono = normalizarTelefono(telefonoRaw)
    if (!telefono || telefono.length < 6) continue
    if (vistos.has(telefono)) continue

    const urlWeb = place.websiteUri?.trim() || null
    const tieneWeb = Boolean(urlWeb)
    if (tieneWeb) continue // queremos solo negocios sin web

    vistos.add(telefono)

    resultados.push({
      nombre: place.displayName?.text || 'Negocio sin nombre',
      direccion: place.formattedAddress || '',
      telefono,
      rating: typeof place.rating === 'number' ? place.rating : 0,
      cantidad_reviews: typeof place.userRatingCount === 'number' ? place.userRatingCount : 0,
      tiene_web: false,
      url_web: null,
      google_maps_url: place.googleMapsUri || '',
      ya_registrado: false,
      rubro,
    })
  }
  return resultados
}

/**
 * Búsqueda en Google Places (New) con rotación automática de keys cuando una
 * agota su cuota mensual. Si todas las keys están agotadas o todas devuelven
 * 429 (rate limit), lanza PlacesAllKeysExhaustedError.
 */
export async function searchPlaces(
  rubro: string,
  zona: string,
  signal?: AbortSignal,
): Promise<PlacesSearchOk> {
  const allKeys = getConfiguredPlacesKeys()
  if (allKeys.length === 0) throw new PlacesNoKeysError()

  // Itera por orden — `pickAvailableKey` ya respeta ese orden — pero hace
  // un máximo de N intentos para tolerar carreras y rotaciones in-vuelo.
  const seenAsExhausted = new Set<string>()
  for (let attempt = 0; attempt < allKeys.length; attempt++) {
    const picked = await pickAvailableKey()
    if (!picked) break
    if (seenAsExhausted.has(picked.key.label)) {
      // ya intentamos esta y la marcamos como no-disponible, evita bucle.
      break
    }

    // Reservamos cupo ANTES de hacer la llamada (decisión atómica vía RPC).
    const newUsed = await consumeQuota(picked.key)
    if (newUsed == null) {
      // Carrera: justo se agotó entre que la elegimos y reservamos.
      seenAsExhausted.add(picked.key.label)
      continue
    }

    let response: { status: number; bodyText: string }
    try {
      response = await callPlacesApi(rubro, zona, picked.key, signal)
    } catch (err) {
      if (signal?.aborted) throw err
      const msg = err instanceof Error ? err.message : 'Error de red llamando a Google Places'
      await annotateKeyError(picked.key, msg)
      throw new Error(msg)
    }

    // 200 OK
    if (response.status >= 200 && response.status < 300) {
      const resultados = parseResultados(rubro, response.bodyText)
      return {
        ok: true,
        resultados,
        key_label: picked.key.label,
        used: newUsed,
        quota: picked.key.quota,
      }
    }

    // 429 = rate limit (cuota mensual o QPM saturados). Marcamos como agotada
    // en el DB y rotamos a la siguiente key.
    if (response.status === 429) {
      const sample = response.bodyText.slice(0, 200)
      await annotateKeyError(
        picked.key,
        `HTTP 429 — RESOURCE_EXHAUSTED (${sample}). Forzamos rotación.`,
      )
      // Quemamos la cuota en el DB para que pickAvailableKey() la salte en
      // búsquedas posteriores (no solo en este loop local).
      await exhaustKeyForMonth(picked.key)
      seenAsExhausted.add(picked.key.label)
      continue
    }

    // 4xx / 5xx no recuperable: anota el error y aborta.
    const sample = response.bodyText.slice(0, 300)
    const errMsg = `Google Places HTTP ${response.status}: ${sample}`
    await annotateKeyError(picked.key, errMsg)
    throw new Error(errMsg)
  }

  throw new PlacesAllKeysExhaustedError(allKeys.length)
}
