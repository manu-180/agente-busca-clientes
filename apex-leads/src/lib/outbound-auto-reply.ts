/**
 * Heurísticas para respuestas automáticas típicas de WhatsApp Business
 * (bienvenida + precios + promo) cuando el primer contacto lo hace APEX (outbound).
 * Última revisión: bot-a-bot detection (2026-05-27)
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
// "Lunes a Viernes de 9 a 12" (muy común en WA Business; sin "de " al inicio)
const RE_LUNES_A_VIERNES_FLEX = /\b(lunes|martes|mi[eé]rcoles)\s+a\s+(viernes|s[aá]bados?)\b/i
// Horarios con "a" entre números o "de X a Y" sin obligar :mm
const RE_HORARIO_ATENCION_FLEX =
  /\b(horario|horarios)\b[\s\S]{0,180}(\d{1,2}\s*(?:hs?\.?|h)\s*)?(?:a|-|hasta)\s*\d{1,2}/i
const RE_DIRECCION_TIPICA =
  /\b(calle|av\.|avenida|ruta)\s+[a-záéíóúñ0-9.\s]{1,48}\d{2,5}\b/i
// "de 9 a 12", "9 a 18 hs", "10:00 a 13:30"
const RE_FRANJA_HORARIA_DIA =
  /\b(de\s+)?\d{1,2}(:\d{2})?\s*(hs?\.?|h\.?)?\s*(a|-|hasta)\s*\d{1,2}/i
const RE_DISCLAIMER_WA_NEGOCIO =
  /\b(NO\s+ATENDEMOS|NO\s+ENVIAMOS|NO\s+CONTESTAMOS\s+LLAMADOS|SOLO\s+WHATSAPP)\b/i
const RE_RESPONDEREMOS_BREVEDAD =
  /\b(te\s+)?responderemos\s+(a\s+la\s+)?brevedad\b|\ba\s+la\s+brevedad\s+te\s+responderemos\b/i
const RE_HORARIO_ATENCION_LITERAL = /\b(nuestro\s+)?horario\s+de\s+atenci[oó]n\b/i

// ── Plantillas de bienvenida institucionales (iglesias, ONGs, consultorios,
// estudios) que NO traen precios ni horarios comerciales pero son claramente
// automáticas: agradecen el contacto, piden tus datos y describen la institución.
// "gracias por tu mensaje / tu consulta / tu contacto"
const RE_GRACIAS_MENSAJE =
  /gracias\s+por\s+(tu|su)\s+(mensaje|consulta|contacto|comunicaci[oó]n|inter[eé]s|preferencia)/i
// "te pedimos que nos digas tu nombre", "dejanos tu nombre y consulta"
const RE_PEDIR_DATOS_CONTACTO =
  /\b(d[eé]janos|dejanos|d[eé]jame|dejame|indicanos|indícanos|decinos|decínos)\b[\s\S]{0,30}\b(nombre|apellido|datos|consulta)\b|te\s+pedimos\s+que\s+nos\s+(digas|indiques|dej[eé]s|cuentes|brindes)/i
// "todos los viernes a las 19:30", "todos los domingos" — agenda recurrente de culto/clase
const RE_DIAS_RECURRENTES =
  /\btodos\s+los\s+(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?|domingos?)\b/i
// Marcadores institucionales (iglesia / comunidad / centro)
const RE_INSTITUCIONAL =
  /\b(entrada\s+(es\s+)?(libre|gratuita)|pedido\s+de\s+oraci[oó]n|bendiciones|culto|misa|congregaci[oó]n|feligreses|actividades\s+especiales)\b/i
// Auto-disclosure: el propio mensaje declara que es automático / fuera de horario.
// Firmas casi imposibles en un comprador real → señal fuerte individual.
const RE_AUTO_DISCLOSURE =
  /\b(este\s+es\s+un\s+)?mensaje\s+autom[aá]tico\b|\brespuesta\s+autom[aá]tica\b|\btu\s+mensaje\s+es\s+(muy\s+)?importante\b|fuera\s+de(l)?\s+horario\s+de\s+atenci[oó]n/i

// ── Patrones de bots de menú numerado (Typebot, ManyChat, Botmaker, etc.) ──
// "escribe SOLO EL NÚMERO de la opción" — firma inequívoca de bot de flujo interactivo
const RE_SOLO_NUMERO_OPCION =
  /\b(escrib[ií]\s+(solo\s+)?el\s+n[uú]mero|solo\s+el\s+n[uú]mero\s+de\s+la\s+opci[oó]n)\b/i
// "Aún estoy aprendiendo" — auto-disclosure de bot de WA Business API
const RE_AUN_APRENDIENDO = /a[uú]n\s+estoy\s+aprendiendo/i

function contarLineasNumeradasMenu(texto: string): number {
  // Líneas que comienzan con "1.", "2.", etc. — menú de opciones típico de bot de flujo
  return (texto.match(/^\s*[1-9]\s*[.)]/gm) ?? []).length
}

/**
 * Detecta bots de menú numerado / flujo interactivo (Typebot, ManyChat, Botmaker).
 * Estos bots NO son capturados por `pareceMensajeAutomaticoNegocio` ni por
 * `pareceMensajeBotConversacional` porque no tienen precios, horarios, ni persona.
 */
export function pareceMensajeMenuNumerado(texto: string): boolean {
  if (!texto || texto.length < 20) return false
  if (RE_SOLO_NUMERO_OPCION.test(texto)) return true
  if (RE_AUN_APRENDIENDO.test(texto)) return true
  // 3+ líneas "N. texto" consecutivas = menú de opciones
  if (contarLineasNumeradasMenu(texto) >= 3) return true
  return false
}

// ── Patrones de chatbots conversacionales (no detectados por las reglas de negocio) ──
// Bot persona: "Soy [Nombre]" seguido de contexto profesional + años de experiencia
const RE_BOT_PERSONA_INTRO =
  /\b(soy|me\s+llamo)\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}[\s\S]*\b\d{1,2}\s+años?\b/i
// 3+ preguntas directas seguidas (¿...? ¿...? ¿...?) — firma de chatbot de calificación
// [^?] ya matchea \n sin necesidad del flag s
const RE_TRIPLE_PREGUNTA = /\?[^?]{0,300}\?[^?]{0,300}\?/
// "Para darte la info justa/correcta, ¿me contarías?" — frase de bot de captación
const RE_PARA_DARTE_INFO = /para\s+darte\s+(la\s+)?info\b/i
// "Qué bueno que te hayas interesado" — apertura típica de bot de ventas
const RE_QUE_BUENO_INTERES = /qu[eé]\s+bueno\s+que\s+(te\s+)?hayas?\s+/i
// "Llevo X años entrenando/trabajando/atendiendo" — experiencia en intro de bot persona
const RE_LLEVO_ANOS = /\bllevo\s+\d{1,2}\s+años?\s+(entrenando|trabajando|atendiendo|ayudando)\b/i
// ── Presentación / bio institucional: "Mi nombre es X", CV de persona o negocio ──
// Apertura típica de presentación (admite asterisco/comilla de WhatsApp antes del nombre).
// El keyword puede arrancar en mayúscula (inicio de oración: "Mi nombre es") o minúscula,
// pero el NOMBRE exige inicial mayúscula (propio) para no matchear "soy bueno"/"soy de acá".
const RE_PRESENTACION_INTRO =
  /\b([Mm]i\s+nombre\s+es|[Mm]e\s+presento|[Mm]e\s+llamo|[Ss]oy)\s+[*"“]?[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}/
// "Modo de contratación:" — firma inequívoca de tarjeta de presentación / catálogo de servicios
const RE_MODO_CONTRATACION = /\bmodo\s+de\s+contrataci[oó]n\b/i
// Señal de comprador real: si el mensaje pide algo concreto o muestra interés,
// NO es una presentación automática aunque incluya datos personales.
const RE_INTERES_COMPRADOR =
  /\b(me\s+interesa|quiero|cu[aá]nto\s+(sale|cuesta|vale)|es\s+gratis|c[oó]mo\s+(funciona|lo\s+descargo|la\s+descargo|me\s+sumo|me\s+anoto)|sirve\s+para|me\s+sumo|lo\s+pruebo|la\s+pruebo|m[aá]s\s+info|informaci[oó]n|precio|presupuesto)\b/i
// Marcadores de bio/CV (tercera persona, trayectoria, servicios profesionales)
function contarBioMarkers(texto: string): number {
  const checks = [
    /\btrayectoria\b/i,
    /\bespecializad[oa]\b/i,
    /\bmi\s+labor\b/i,
    /\bme\s+dedico\b/i,
    /\bamplia\s+experiencia\b/i,
    /\bcuento\s+con\b/i,
    /\bbrindo\b/i,
    /\bofrezco\b/i,
    /\ba[nñ]os\s+de\s+experiencia\b/i,
    /\bacompa[nñ]amiento\b/i,
  ]
  return checks.filter(re => re.test(texto)).length
}

function tieneBloquesEmojisDecorativos(texto: string): boolean {
  // 3+ emojis consecutivos (pares sustitutos) — decoración típica de auto-replies de negocios
  return /([\uD800-\uDBFF][\uDC00-\uDFFF]\s*){3,}/.test(texto)
}

/**
 * True si ya hubo al menos un mensaje del cliente que no califica como auto-reply
 * típico de WhatsApp Business. Hasta que eso pase, conviene no volver a “vender”
 * con el modelo completo en outbound (evita 2–3 pitches seguidos por cada
 * fragmento distinto del menú automático del negocio).
 */
export function clienteYaMandoAlgoNoAutomatico(
  historial: Array<{ rol: string; mensaje: string | null | undefined }>
): boolean {
  return historial
    .filter(h => h.rol === 'cliente' && h.mensaje)
    .some(h => !pareceMensajeAutomaticoCliente(String(h.mensaje)))
}

/**
 * Mensajes muy cortos típicos de WhatsApp Business / chatbots que NO superan
 * el umbral de 40 caracteres de `pareceMensajeAutomaticoNegocio` pero disparan
 * el motor de decisión (p. ej. por llevar "?") y generan pitches LLM repetidos.
 */
export function esAutoReplyCortoNegocio(texto: string): boolean {
  const t = (texto ?? '').trim()
  if (!t) return false
  if (RE_EN_QUE_AYUDAR.test(t)) return true
  if (RE_COMUNICARTE_CON.test(t)) return true
  if (RE_RESPONDEREMOS_BREVEDAD.test(t)) return true
  if (RE_HORARIO_ATENCION_LITERAL.test(t) && t.length < 220) return true
  if (RE_GRACIAS_CONTACTO.test(t) && t.length < 160) return true
  return false
}

export function pareceMensajeAutomaticoNegocio(texto: string): boolean {
  if (!texto) return false
  if (esAutoReplyCortoNegocio(texto)) return true
  if (pareceMensajeMenuNumerado(texto)) return true
  // Auto-disclosure ("mensaje automático", "fuera del horario de atención") es señal
  // fuerte por sí sola, sin importar la longitud.
  if (RE_AUTO_DISCLOSURE.test(texto)) return true
  if (texto.length < 40) return false
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
    RE_HORARIO_ATENCION_FLEX.test(texto),
    RE_EN_QUE_AYUDAR.test(texto),
    RE_DIAS_LABORALES.test(texto),
    RE_LUNES_A_VIERNES_FLEX.test(texto),
    RE_FRANJA_HORARIA_DIA.test(texto),
    RE_DIRECCION_TIPICA.test(texto),
    RE_DISCLAIMER_WA_NEGOCIO.test(texto),
    RE_RESPONDEREMOS_BREVEDAD.test(texto),
    RE_HORARIO_ATENCION_LITERAL.test(texto),
    tieneBloquesEmojisDecorativos(texto),
    RE_GRACIAS_MENSAJE.test(t),
    RE_PEDIR_DATOS_CONTACTO.test(texto),
    RE_DIAS_RECURRENTES.test(texto),
    RE_INSTITUCIONAL.test(t),
  ]
  const n = señales.filter(Boolean).length
  if (n >= 2) return true
  // Señal fuerte individual: "gracias por comunicarte con [negocio]" es casi siempre auto-reply
  if (RE_COMUNICARTE_CON.test(texto)) return true
  // Bienvenida clásica con mensaje largo y algún $
  if (RE_BIENVENIDO.test(texto) && texto.length > 160 && dolares >= 1) return true
  // Cartel de negocio: dirección + días/horarios (menú automático típico)
  if (texto.length >= 80 && RE_DIRECCION_TIPICA.test(texto) && RE_LUNES_A_VIERNES_FLEX.test(texto)) {
    return true
  }
  if (texto.length >= 100 && RE_LUNES_A_VIERNES_FLEX.test(texto) && RE_HORARIO_ATENCION_FLEX.test(texto)) {
    return true
  }
  if (texto.length >= 90 && RE_LUNES_A_VIERNES_FLEX.test(texto) && RE_FRANJA_HORARIA_DIA.test(texto)) {
    return true
  }
  return false
}

/**
 * Respuesta fija post–menú automático de WA Business (no cuenta como “pitch” para el
 * cap outbound). Detecta TODAS las variantes por proyecto (APEX → theapexweb.com,
 * Assistify/self-serve → link de descarga) vía el prefijo compartido. Si cambia el
 * prefijo en `respuestas-canned.ts`/`RESPUESTA_OUTBOUND_TRAS_AUTOMATICO`, actualizá esto.
 */
export function esPlantillaRespuestaOutboundAuto(mensaje: string | null | undefined): boolean {
  if (!mensaje || typeof mensaje !== 'string') return false
  return (
    mensaje.includes('Eso suele ser el mensaje automático del negocio') &&
    mensaje.includes('la propuesta ya quedó arriba')
  )
}

export const RESPUESTA_OUTBOUND_TRAS_AUTOMATICO = `Gracias por la info. Eso suele ser el mensaje automático del negocio: *la propuesta ya quedó arriba* en nuestro primer mensaje.

Cuando quieras charlamos con calma. Para ver trabajos de APEX: *www.theapexweb.com*`

/** Respuesta cuando un intermediario/portero dice que va a reenviar el mensaje al decisor */
export const RESPUESTA_GATEKEEPER = `Perfecto, gracias. Si le podés comentar que dejamos una propuesta arriba, genial. Cuando quieran charlar, por acá estamos.`

/** Cliente dice que no tiene negocio / no es el dueño / número equivocado. Disculpa y cierra. */
export const RESPUESTA_WRONG_TARGET = `Uh, disculpame la molestia. Tu número quedó por error en una base que armé buscando comercios de la zona — lo borro ahora. Que tengas buen día.`

/** Cliente dice que ya cerró el negocio / ya no tiene el local. Disculpa y cierra. */
export const RESPUESTA_BUSINESS_CLOSED = `No tenía idea, disculpá. Te borro de la base entonces. Éxitos en lo que sigas.`

/** Familiar/conocido que dice "se lo paso", "le aviso". Variante suave del gatekeeper. */
export const RESPUESTA_FAMILY_RELAY = `Dale, gracias. Si querés mostrale lo que dejamos arriba, sin compromiso. Si lo charlan y les interesa, por acá estamos.`

/** Cliente pregunta de dónde sacamos el número (sospecha/desconfianza, sin negar negocio). */
export const RESPUESTA_SUSPICION = `Tranqui, lo saqué de Google Maps — busco comercios de la zona y el rubro con el que trabajo, nada raro. Si no te interesa lo borro y listo.`

/**
 * Detecta mensajes de chatbots conversacionales de WhatsApp Business que no
 * son capturados por `pareceMensajeAutomaticoNegocio` (que apunta a menús
 * estáticos de precios/horarios). Este patrón apunta a bots de captación que
 * se presentan como una persona y hacen preguntas de calificación.
 */
export function pareceMensajeBotConversacional(texto: string): boolean {
  if (!texto || texto.length < 30) return false
  if (RE_COMUNICARTE_CON.test(texto)) return true
  if (RE_QUE_BUENO_INTERES.test(texto) && RE_TRIPLE_PREGUNTA.test(texto)) return true
  if (RE_BOT_PERSONA_INTRO.test(texto) && texto.length > 120) return true
  if (RE_LLEVO_ANOS.test(texto) && RE_PARA_DARTE_INFO.test(texto)) return true
  if (RE_LLEVO_ANOS.test(texto) && RE_TRIPLE_PREGUNTA.test(texto)) return true
  if (RE_PARA_DARTE_INFO.test(texto) && RE_TRIPLE_PREGUNTA.test(texto)) return true
  // Presentación / bio institucional (CV de persona o negocio). Se descarta si el
  // mensaje muestra interés concreto del comprador (no queremos tratar a un lead
  // real que se presenta y pregunta como si fuera un auto-reply).
  if (!RE_INTERES_COMPRADOR.test(texto)) {
    if (RE_MODO_CONTRATACION.test(texto)) return true
    const bioHits = contarBioMarkers(texto)
    if (RE_PRESENTACION_INTRO.test(texto) && texto.length > 120 && bioHits >= 1) return true
    if (bioHits >= 2 && texto.length > 160) return true
  }
  return false
}

/**
 * Predicado unificado: ¿el mensaje del cliente parece automático / predefinido?
 * Cubre los tres tipos: auto-reply de WhatsApp Business (precios/horarios/bienvenida
 * institucional), bots de menú numerado, y presentaciones/bios. Es la ÚNICA fuente
 * de verdad para decidir si en outbound respondemos con la plantilla project-aware
 * ("la propuesta quedó arriba") en lugar de abrir el LLM con un pitch.
 */
export function pareceMensajeAutomaticoCliente(texto: string | null | undefined): boolean {
  if (!texto || typeof texto !== 'string') return false
  return (
    pareceMensajeAutomaticoNegocio(texto) ||
    pareceMensajeBotConversacional(texto) ||
    pareceMensajeMenuNumerado(texto)
  )
}

/**
 * Analiza el historial completo y devuelve `true` si la conversación es
 * bot-a-bot. Criterios:
 * - 2+ mensajes del cliente que parecen automáticos/bot
 * - o bien, 6+ mensajes del cliente y >= 50% son automáticos
 *
 * Cuando esto ocurre, el agente debe desactivarse para ese lead sin responder.
 */
export function detectarConversacionBot(
  historial: Array<{ rol: string; mensaje: string | null | undefined }>
): boolean {
  const mensajesCliente = historial
    .filter(h => h.rol === 'cliente' && h.mensaje)
    .map(h => String(h.mensaje))

  if (mensajesCliente.length < 2) return false

  const esBot = (m: string) =>
    pareceMensajeAutomaticoNegocio(m) || pareceMensajeBotConversacional(m)

  const botCount = mensajesCliente.filter(esBot).length

  // 2+ mensajes bot detectados → ban inmediato (antes: 4 — se bajó por el caso menú numerado)
  if (botCount >= 2) return true

  // Con >= 6 mensajes del cliente y mayoría automáticos → es un loop
  if (mensajesCliente.length >= 6 && botCount / mensajesCliente.length >= 0.5) return true

  return false
}
