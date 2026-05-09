/**
 * Detección y manejo de múltiples API keys de Google Places.
 *
 * Convención de env vars:
 *   GOOGLE_PLACES_API_KEY      → key #1 (siempre la primera)
 *   GOOGLE_PLACES_API_KEY_2    → key #2
 *   GOOGLE_PLACES_API_KEY_3    → key #3
 *   ... y así sucesivamente
 *
 * Cada key arranca con cupo gratuito de 1000 requests/mes en el SKU
 * "Text Search Enterprise" (el que devuelve `websiteUri`). El reset de
 * Google ocurre el día 1 a las 00:00 hora del Pacífico de EE.UU.
 */

const ENTERPRISE_TEXT_SEARCH_FREE_QUOTA = 1000
const PRIMARY_KEY_QUOTA = 900

export interface PlacesKey {
  /** Etiqueta de la env var (ej: "GOOGLE_PLACES_API_KEY_2") */
  label: string
  /** Valor de la API key (no exponer al cliente) */
  value: string
  /** Últimos 4 caracteres para mostrar en UI sin filtrar la key entera */
  suffix: string
  /** Cupo mensual (default 1000 = Text Search Enterprise free tier) */
  quota: number
}

function tail(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= 4) return trimmed
  return trimmed.slice(-4)
}

/**
 * Lee todas las API keys configuradas en el proceso. Devuelve en el orden de
 * "primera → última" (la #1 se agota primero, luego la #2, etc.).
 *
 * Detección dinámica: cualquier env var `GOOGLE_PLACES_API_KEY_<N>` con N≥2
 * es considerada una key adicional. Se admite gap (ej. _2 y _4 sin _3).
 */
export function getConfiguredPlacesKeys(): PlacesKey[] {
  const out: PlacesKey[] = []

  const primary = process.env.GOOGLE_PLACES_API_KEY?.trim()
  if (primary) {
    out.push({
      label: 'GOOGLE_PLACES_API_KEY',
      value: primary,
      suffix: tail(primary),
      quota: PRIMARY_KEY_QUOTA,
    })
  }

  const numericLabels: Array<{ label: string; value: string; n: number }> = []
  for (const [name, raw] of Object.entries(process.env)) {
    if (!raw) continue
    const m = name.match(/^GOOGLE_PLACES_API_KEY_(\d+)$/)
    if (!m) continue
    const n = Number(m[1])
    if (!Number.isFinite(n) || n < 2) continue
    const value = raw.trim()
    if (!value) continue
    numericLabels.push({ label: name, value, n })
  }
  numericLabels.sort((a, b) => a.n - b.n)
  for (const k of numericLabels) {
    out.push({
      label: k.label,
      value: k.value,
      suffix: tail(k.value),
      quota: ENTERPRISE_TEXT_SEARCH_FREE_QUOTA,
    })
  }

  return out
}

/**
 * Mes calendario en hora del Pacífico de EE.UU. (formato "YYYY-MM").
 * Alineado con el reset mensual de cuotas gratuitas de Google Maps Platform.
 */
export function currentMonthLabelPT(now: Date = new Date()): string {
  // en-CA con timeZone PT da "YYYY-MM-DD" → tomamos los 7 primeros chars.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const ymd = fmt.format(now) // "2026-05-07"
  return ymd.slice(0, 7) // "2026-05"
}

export const PLACES_FREE_MONTHLY_QUOTA = ENTERPRISE_TEXT_SEARCH_FREE_QUOTA
