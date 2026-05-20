/**
 * Detección y manejo de múltiples API keys de Google Places.
 *
 * Convención de env vars:
 *   GOOGLE_PLACES_API_KEY      → key #1 (siempre la primera)
 *   GOOGLE_PLACES_API_KEY_2    → key #2
 *   GOOGLE_PLACES_API_KEY_3    → key #3
 *   ... y así sucesivamente
 *
 * Override de cupo (opcional, default 900 para la #1 y 1000 para las demás):
 *   GOOGLE_PLACES_QUOTA        → override del cupo de la key #1
 *   GOOGLE_PLACES_QUOTA_2      → override del cupo de la key #2
 *   GOOGLE_PLACES_QUOTA_3      → ...
 *
 * Cada key arranca con cupo gratuito de 1000 requests/mes en el SKU
 * "Text Search Enterprise" (el que devuelve `websiteUri`). El reset de
 * Google ocurre el día 1 a las 00:00 hora del Pacífico de EE.UU.
 */

const ENTERPRISE_TEXT_SEARCH_FREE_QUOTA = 1000
const DEFAULT_PRIMARY_QUOTA = 900
const HARD_MAX_QUOTA = 1000 // tope físico del free tier de Google

export interface PlacesKey {
  /** Etiqueta de la env var (ej: "GOOGLE_PLACES_API_KEY_2") */
  label: string
  /** Valor de la API key (no exponer al cliente) */
  value: string
  /** Últimos 4 caracteres para mostrar en UI sin filtrar la key entera */
  suffix: string
  /** Cupo mensual configurado (override via env si existe) */
  quota: number
}

function tail(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= 4) return trimmed
  return trimmed.slice(-4)
}

/**
 * Lee el override de cupo (env var `GOOGLE_PLACES_QUOTA[_N]`). Si no existe,
 * inválido o fuera del rango [1, 1000], cae al default. Nunca permitimos
 * superar 1000 porque ese es el tope real del free tier de Google.
 */
function resolveQuotaOverride(envName: string, fallback: number): number {
  const raw = process.env[envName]?.trim()
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(Math.floor(n), HARD_MAX_QUOTA)
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
      quota: resolveQuotaOverride('GOOGLE_PLACES_QUOTA', DEFAULT_PRIMARY_QUOTA),
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
      quota: resolveQuotaOverride(`GOOGLE_PLACES_QUOTA_${k.n}`, ENTERPRISE_TEXT_SEARCH_FREE_QUOTA),
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

/**
 * Devuelve el instante UTC del próximo reset mensual de Google (día 1 a las
 * 00:00 hora del Pacífico). Maneja DST automáticamente porque le pregunta a
 * la zona PT cuál es la hora UTC que corresponde a su "00:00".
 */
export function nextResetAtPT(now: Date = new Date()): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now) // "YYYY-MM-DD"
  const [yStr, mStr] = ymd.split('-')
  const y = Number(yStr)
  const m = Number(mStr)
  const nextMonth = m === 12 ? 1 : m + 1
  const nextYear = m === 12 ? y + 1 : y

  // Probamos los dos posibles offsets de PT (UTC-7 PDT, UTC-8 PST). El correcto
  // es el que, visto desde America/Los_Angeles, marca exactamente las 00:00
  // del día 1.
  for (const utcHour of [7, 8]) {
    const probe = new Date(Date.UTC(nextYear, nextMonth - 1, 1, utcHour, 0, 0))
    const ptHour = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: '2-digit',
      hour12: false,
    }).format(probe)
    if (ptHour === '00' || ptHour === '24') return probe
  }
  // Fallback ultra-defensivo: tomamos PST (UTC-8) aunque DST esté activo.
  return new Date(Date.UTC(nextYear, nextMonth - 1, 1, 8, 0, 0))
}

/**
 * Días enteros restantes hasta el próximo reset de Google. Redondea hacia
 * arriba: si faltan 26 horas, devuelve 2.
 */
export function daysUntilNextResetPT(now: Date = new Date()): number {
  const next = nextResetAtPT(now)
  const diffMs = next.getTime() - now.getTime()
  if (diffMs <= 0) return 0
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000))
}

export const PLACES_FREE_MONTHLY_QUOTA = ENTERPRISE_TEXT_SEARCH_FREE_QUOTA
