/**
 * Heurísticas para respuestas automáticas típicas de WhatsApp Business
 * (bienvenida + precios + promo) cuando el primer contacto lo hace APEX (outbound).
 */

const RE_BIENVENIDO = /bienvenid[oa]\b/i
const RE_PROMO = /\b(promo|promoci[oó]n)\b/i
const RE_INSTAGRAM = /instagram\.com|\@[a-z0-9._]{3,}/i
const RE_LISTA_PRECIO = /\b(pase\s+libre|mensualidad|matr[ií]cula|membres[ií]a|cuota)\b/i
const RE_GRACIAS_CONTACTO = /gracias\s+por\s+(contactar|escribir|comunicar)/i
// Señal fuerte: saludo de bienvenida de WA Business con nombre del negocio
const RE_COMUNICARTE_CON = /gracias\s+por\s+comunicarte\s+con\b/i
// Mensajes con horarios de atención ("nuestro horario es de 10:00 a 13:30")
const RE_HORARIO_ATENCION = /\bhorario\b[\s\S]{0,100}\d{1,2}:\d{2}/i
// "¿en qué puedo/podemos ayudarte/ayudarlo?"
const RE_EN_QUE_AYUDAR = /en\s+qu[eé]\s+(puedo|podemos|te\s+puedo|te\s+podemos)\s+ayudar/i
// "de lunes a viernes/sábados/domingos"
const RE_DIAS_LABORALES = /de\s+lunes\s+a\s+(viernes|s[aá]bados?|domingos?)\b/i

function tieneBloquesEmojisDecorativos(texto: string): boolean {
  // 3+ emojis consecutivos (pares sustitutos) — decoración típica de auto-replies de negocios
  return /([\uD800-\uDBFF][\uDC00-\uDFFF]\s*){3,}/.test(texto)
}

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
    RE_HORARIO_ATENCION.test(texto),
    RE_EN_QUE_AYUDAR.test(texto),
    RE_DIAS_LABORALES.test(texto),
    tieneBloquesEmojisDecorativos(texto),
  ]
  const n = señales.filter(Boolean).length
  if (n >= 2) return true
  // Señal fuerte individual: "gracias por comunicarte con [negocio]" es casi siempre auto-reply
  if (RE_COMUNICARTE_CON.test(texto)) return true
  // Bienvenida clásica con mensaje largo y algún $
  if (RE_BIENVENIDO.test(texto) && texto.length > 160 && dolares >= 1) return true
  return false
}

export const RESPUESTA_OUTBOUND_TRAS_AUTOMATICO = `Gracias por la info. Te escribimos nosotros con una propuesta que quedó en el mensaje de arriba.

Cuando quieras charlamos. Para conocer el trabajo de APEX entrá a *www.theapexweb.com*`
