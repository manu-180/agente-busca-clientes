/**
 * Normalización del link de la página de Carta (proyecto `restaurant_multi_tant`)
 * que viaja en `lead.pagina_url` y termina en el PRIMER mensaje de WhatsApp.
 *
 * Por qué existe: las páginas de Carta se generan con `${NEXT_PUBLIC_APP_URL}/r/<slug>`.
 * Las primeras ~373 se publicaron cuando ese env apuntaba al dominio gratuito de
 * Vercel (`carta-tawny-alpha.vercel.app`), así que esas filas quedaron con un
 * `pagina_url` tipo `https://carta-tawny-alpha.vercel.app/r/<slug>`. El dominio
 * propio del producto es `www.carta.it.com`, y el primer contacto NUNCA debería
 * mostrarle a un lead un link `*.vercel.app` (se ve poco serio y es frágil).
 *
 * Este guard reescribe el ORIGIN al dominio canónico preservando `/r/<slug>` +
 * querystring, sea cual sea el estado de la fila en la DB. Es idempotente: una
 * URL que ya está en `www.carta.it.com` vuelve igual.
 *
 * Pura y sin I/O: se puede usar tanto en el cron (`construirMensajePrimerContacto`)
 * como en el generador IA (`generarPrimerMensaje`).
 */

/** Dominio canónico de Carta (con `www`, como lo sirve el deploy de producción). */
export const CARTA_CANONICAL_ORIGIN = 'https://www.carta.it.com'

/**
 * Devuelve `pagina_url` con el dominio canónico de Carta.
 *
 * - Vacío/`null`/no parseable → `null` (el caller cae a su fallback habitual).
 * - Host `*.vercel.app` o `*.carta.it.com` (o `carta.it.com` pelado) → se reescribe
 *   a `https://www.carta.it.com` conservando path + query + hash.
 * - Cualquier otro host (p. ej. una web propia del lead ajena a Carta) → se
 *   devuelve tal cual, sin tocar.
 */
export function normalizarPaginaUrlCarta(raw: string | null | undefined): string | null {
  const url = (raw ?? '').trim()
  if (!url) return null

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    // No es una URL absoluta válida — la dejamos como vino (no rompemos el envío).
    return url
  }

  const host = parsed.hostname.toLowerCase()
  const esPaginaCarta =
    host.endsWith('.vercel.app') || host === 'carta.it.com' || host.endsWith('.carta.it.com')

  if (!esPaginaCarta) return url

  return `${CARTA_CANONICAL_ORIGIN}${parsed.pathname}${parsed.search}${parsed.hash}`
}
