import { waitUntil } from '@vercel/functions'

/**
 * ¿Corresponde generar la carta de Carta para este lead? Pura y testeable: solo
 * para el proyecto Carta (slug 'carta') y leads que todavía NO tienen su página
 * generada (`pagina_url`). Los demás proyectos usan links fijos (theapexweb.com /
 * assistify.lat), no se autogenera nada.
 */
export function debeGenerarCartaParaLead(opts: {
  projectSlug: string | null | undefined
  paginaUrl: string | null | undefined
}): boolean {
  return opts.projectSlug === 'carta' && !(opts.paginaUrl ?? '').trim()
}

const CARTA_BASE_URL_DEFAULT = 'https://www.carta.it.com'
const DISPARO_TIMEOUT_MS = 8000

/**
 * Pieza B — "que el lead SIEMPRE tenga su carta". Dispara (fire-and-forget) la
 * generación de la página de Carta de un lead en el repo Carta, en el momento en
 * que apex-leads lo contacta por primera vez (su cron de envío). Así, para cuando
 * el lead responde, su `pagina_url` ya está escrito y el agente comparte su carta
 * real ([BOCETO]) de forma proactiva. Solo genera lo que efectivamente se contacta
 * (no quema el trial de 30 días de los fríos).
 *
 * - No bloquea el tick del cron: Carta responde 202 al toque y genera en background
 *   (`after()`); acá usamos `waitUntil` + `AbortController` con timeout corto.
 * - Idempotente del lado de Carta; el cron `generate-active` es la red de seguridad
 *   para lo que no se dispare acá.
 * - Si falta `CARTA_GEN_SECRET` (env var), es un NO-OP silencioso → el deploy es
 *   seguro aunque la variable todavía no esté configurada en Vercel.
 */
export function dispararGeneracionCarta(opts: {
  projectSlug: string | null | undefined
  paginaUrl: string | null | undefined
  leadId: string
}): void {
  if (!debeGenerarCartaParaLead(opts)) return

  const secret = process.env.CARTA_GEN_SECRET
  if (!secret) return // sin secret → no-op (deploy seguro hasta que se configure)

  const base = (process.env.CARTA_BASE_URL || CARTA_BASE_URL_DEFAULT).replace(/\/+$/, '')
  const url = `${base}/api/hooks/generate-lead`
  const leadId = opts.leadId

  const work = (async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DISPARO_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
        body: JSON.stringify({ leadId }),
        signal: controller.signal,
      })
      if (!res.ok) {
        console.warn(`[carta-gen] disparo no-ok (${res.status}) lead=${leadId}`)
      }
    } catch (e) {
      console.warn(`[carta-gen] disparo falló lead=${leadId}:`, e instanceof Error ? e.message : e)
    } finally {
      clearTimeout(timer)
    }
  })()

  // waitUntil deja vivir el fetch tras la respuesta del cron sin bloquear el tick.
  // Fuera del runtime de Vercel (p. ej. tests) waitUntil puede no existir → swallow.
  try {
    waitUntil(work)
  } catch {
    void work
  }
}
