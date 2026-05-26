import { ResultadoBusquedaLead } from '@/types'
import { PlacesKey, getConfiguredPlacesKeys } from './keys'
import {
  annotateKeyError,
  exhaustKeyForMonth,
  pickAvailableKey,
  recordPlacesCall,
} from './quota'

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

// Reintentos por key cuando el error es transitorio (5xx, rate-limit por
// minuto). Después de N intentos en la misma key, rotamos a la siguiente.
const MAX_TRANSIENT_RETRIES_PER_KEY = 2
// Backoff base (ms) — crece exponencialmente: 600, 1200, 2400...
const BACKOFF_BASE_MS = 600
// Tope de seguridad para no quedarnos eternamente loopeando entre keys.
const MAX_TOTAL_ATTEMPTS = 8

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

export interface SearchPlacesOptions {
  /** Si true, descarta resultados con `websiteUri` (uso clásico de APEX). */
  filtroSinWeb: boolean
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

function parseResultados(
  rubro: string,
  bodyText: string,
  options: SearchPlacesOptions,
): ResultadoBusquedaLead[] {
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
    // El filtro "solo sin web" es project-specific: APEX lo usa porque vende
    // páginas web; Assistify/Handy/botlode lo dejan en false para no perder
    // negocios que ya tienen presencia online.
    if (options.filtroSinWeb && tieneWeb) continue

    vistos.add(telefono)

    resultados.push({
      nombre: place.displayName?.text || 'Negocio sin nombre',
      direccion: place.formattedAddress || '',
      telefono,
      rating: typeof place.rating === 'number' ? place.rating : 0,
      cantidad_reviews: typeof place.userRatingCount === 'number' ? place.userRatingCount : 0,
      tiene_web: tieneWeb,
      url_web: urlWeb,
      google_maps_url: place.googleMapsUri || '',
      ya_registrado: false,
      rubro,
    })
  }
  return resultados
}

/**
 * Tipos de error reconocidos en respuestas 4xx/5xx de Google Places.
 *
 *  - `quota_exhausted`: la cuota mensual se quemó (429 + status RESOURCE_EXHAUSTED
 *    sin mención de "per minute"). Marcamos la key como agotada y rotamos.
 *  - `rate_limited`: rate limit por minuto/segundo (429 + "per minute" en el
 *    detalle). Es transitorio: reintentamos en la misma key con backoff.
 *  - `transient`: 5xx u otros errores transitorios. Reintento con backoff en
 *    la misma key.
 *  - `key_invalid`: 401/403 — key inválida, restringida, billing apagado, API
 *    no habilitada. NO consumimos cuota, rotamos.
 *  - `fatal`: el resto (400 con request mal formado, etc.). Anotamos y rotamos.
 */
type ErrorKind = 'quota_exhausted' | 'rate_limited' | 'transient' | 'key_invalid' | 'fatal'

function classifyError(status: number, bodyText: string): ErrorKind {
  if (status === 401 || status === 403) return 'key_invalid'

  if (status === 429) {
    const lower = bodyText.toLowerCase()
    // Rate limit por minuto/segundo viene típicamente con menciones a
    // "per minute" o "per second" o quota IDs como "PerMinute"/"QPS".
    if (
      lower.includes('per minute') ||
      lower.includes('per second') ||
      lower.includes('perminute') ||
      lower.includes('queriespersecond') ||
      lower.includes('queriespermin')
    ) {
      return 'rate_limited'
    }
    return 'quota_exhausted'
  }

  if (status >= 500 && status < 600) return 'transient'
  if (status === 408) return 'transient' // request timeout

  return 'fatal'
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Búsqueda en Google Places (New) con rotación automática de keys + reintentos
 * con backoff para errores transitorios. Política por código de estado:
 *
 *  - 2xx: contamos la llamada (recordPlacesCall) y devolvemos resultados.
 *  - 401/403: NO contamos cuota, anotamos el error, rotamos a la siguiente key.
 *  - 429 RESOURCE_EXHAUSTED (cuota mensual): marcamos la key como agotada y rotamos.
 *  - 429 rate-limit por minuto/segundo: reintento con backoff en la misma key.
 *  - 5xx / 408: reintento con backoff en la misma key.
 *  - Otros 4xx: anotamos error, rotamos a la siguiente key.
 *
 * Si todas las keys se quemaron o salieron por error, tira PlacesAllKeysExhaustedError.
 */
export async function searchPlaces(
  rubro: string,
  zona: string,
  options: SearchPlacesOptions,
  signal?: AbortSignal,
): Promise<PlacesSearchOk> {
  const allKeys = getConfiguredPlacesKeys()
  if (allKeys.length === 0) throw new PlacesNoKeysError()

  const blacklisted = new Set<string>() // keys agotadas o caídas DURANTE esta búsqueda
  let totalAttempts = 0
  let lastFatal: string | null = null

  while (totalAttempts < MAX_TOTAL_ATTEMPTS) {
    totalAttempts++

    const picked = await pickAvailableKey()
    if (!picked) break
    if (blacklisted.has(picked.key.label)) break // pickAvailableKey volvió a darnos una que ya descartamos → no hay más

    // Reintentos contra errores transitorios en ESTA misma key.
    let transientAttempts = 0
    let rotateToNextKey = false
    let result: PlacesSearchOk | null = null

    while (transientAttempts <= MAX_TRANSIENT_RETRIES_PER_KEY) {
      let response: { status: number; bodyText: string }
      try {
        response = await callPlacesApi(rubro, zona, picked.key, signal)
      } catch (err) {
        if (signal?.aborted) throw err
        const msg = err instanceof Error ? err.message : 'Error de red llamando a Google Places'
        // Error de red: reintento con backoff en la misma key (hasta el tope).
        if (transientAttempts < MAX_TRANSIENT_RETRIES_PER_KEY) {
          transientAttempts++
          await delay(BACKOFF_BASE_MS * 2 ** (transientAttempts - 1), signal)
          continue
        }
        await annotateKeyError(picked.key, `Red: ${msg}`)
        lastFatal = msg
        rotateToNextKey = true
        blacklisted.add(picked.key.label)
        break
      }

      // 2xx → contamos y devolvemos.
      if (response.status >= 200 && response.status < 300) {
        const resultados = parseResultados(rubro, response.bodyText, options)
        const newUsed = await recordPlacesCall(picked.key)
        result = {
          ok: true,
          resultados,
          key_label: picked.key.label,
          used: newUsed ?? picked.used + 1,
          quota: picked.key.quota,
        }
        break
      }

      const kind = classifyError(response.status, response.bodyText)
      const sample = response.bodyText.slice(0, 220)

      if (kind === 'rate_limited' || kind === 'transient') {
        if (transientAttempts < MAX_TRANSIENT_RETRIES_PER_KEY) {
          transientAttempts++
          await delay(BACKOFF_BASE_MS * 2 ** (transientAttempts - 1), signal)
          continue
        }
        // Agotamos reintentos en esta key — anotamos y rotamos sin marcar
        // agotada (rate limit es temporal, no permanente).
        await annotateKeyError(
          picked.key,
          `HTTP ${response.status} ${kind} (${sample}). Reintentos agotados, rotando.`,
        )
        rotateToNextKey = true
        blacklisted.add(picked.key.label)
        break
      }

      if (kind === 'quota_exhausted') {
        await annotateKeyError(
          picked.key,
          `HTTP 429 RESOURCE_EXHAUSTED (${sample}). Cuota mensual quemada.`,
        )
        await exhaustKeyForMonth(picked.key)
        rotateToNextKey = true
        blacklisted.add(picked.key.label)
        break
      }

      if (kind === 'key_invalid') {
        // 401/403: la key NO está sirviendo. Anotamos pero NO consumimos cuota
        // ni la marcamos agotada (el usuario debe arreglar la config).
        await annotateKeyError(
          picked.key,
          `HTTP ${response.status} key inválida/restringida (${sample}). No consume cuota; rotando.`,
        )
        rotateToNextKey = true
        blacklisted.add(picked.key.label)
        break
      }

      // fatal: 400 con request malformado u otro 4xx. Probablemente sea bug
      // nuestro, no de la key. Pero si rotamos puede que la siguiente devuelva
      // lo mismo. Anotamos contra esta key y rotamos igual: si todas fallan
      // con fatal, terminamos en PlacesAllKeysExhaustedError con info en logs.
      await annotateKeyError(picked.key, `HTTP ${response.status} fatal: ${sample}`)
      lastFatal = `HTTP ${response.status}: ${sample}`
      rotateToNextKey = true
      blacklisted.add(picked.key.label)
      break
    }

    if (result) return result
    if (rotateToNextKey) continue

    // Si llegamos acá es que salimos del loop interno sin resultado ni rotación
    // (no debería pasar) — rompemos para evitar loop infinito.
    break
  }

  // Si en el camino hubo un error de red/fatal contra alguna key, propagamos
  // ese mensaje (más útil que "cuota agotada" si el problema real era otro).
  // Si TODAS fallaron exclusivamente por cuota/rate, tiramos all-exhausted.
  if (lastFatal) throw new Error(`Google Places: ${lastFatal}`)
  throw new PlacesAllKeysExhaustedError(allKeys.length)
}
