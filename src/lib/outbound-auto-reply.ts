/**
 * Heurísticas para respuestas automáticas típicas de WhatsApp Business
 * (bienvenida + precios + promo) cuando el primer contacto lo hace APEX (outbound).
 */

const RE_BIENVENIDO = /bienvenid[oa]\b/i
const RE_PROMO = /\b(promo|promoci[oó]n)\b/i
const RE_INSTAGRAM = /instagram\.com|\@[a-z0-9._]{3,}/i
const RE_LISTA_PRECIO = /\b(pase\s+libre|mensualidad|matr[ií]cula|membres[ií]a|cuota)\b/i
const RE_GRACIAS_CONTACTO = /gracias\s+por\s+(contactar|escribir|comunicar)/i

export function pareceMensajeAutomaticoNegocio(texto: string): boolean {
  if (!texto || texto.length < 40) return false
  const t = texto.toLowerCase()
  const dolares = (texto.match(/\$/g) || []).length
  const señales = [
    RE_BIENVENIDO.test(texto),
    RE_PROMO.test(t),
    dolares >= 2,
    RE_INSTAGRAM.test(texto),
    RE_LISTA_PRECIO.test(t),
    RE_GRACIAS_CONTACTO.test(t),
    t.length > 260 && /\$\d/.test(texto),
  ]
  const n = señales.filter(Boolean).length
  return n >= 2 || (RE_BIENVENIDO.test(texto) && texto.length > 160 && dolares >= 1)
}

/** Tras insertar el mensaje entrante: solo un mensaje de cliente en el hilo. */
export function esPrimeraRespuestaCliente(historial: { rol: string }[]): boolean {
  return historial.filter(m => m.rol === 'cliente').length === 1
}

export const RESPUESTA_OUTBOUND_TRAS_AUTOMATICO = `Hola! Te escribimos nosotros recién con la propuesta; el *boceto* y el link quedaron en el mensaje de arriba.

Para ver *servicios* y casos de APEX, entrá a *www.theapexweb.com*. Si te interesa, contestame y lo vemos.`
