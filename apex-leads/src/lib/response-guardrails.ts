import {
  detectarVertical,
  detectarVerticalIntrusa,
  labelVertical,
  terminosPermitidos,
  terminosProhibidos,
  type VerticalId,
} from '@/lib/verticales'

const MAX_CHARS = 600

function compactWhitespace(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function removeRepeatedLines(text: string): string {
  const seen = new Set<string>()
  const lines = text.split('\n')
  const filtered: string[] = []
  for (const line of lines) {
    const key = line.trim().toLowerCase()
    if (!key) {
      filtered.push(line)
      continue
    }
    if (seen.has(key)) continue
    seen.add(key)
    filtered.push(line)
  }
  return filtered.join('\n')
}

function truncarEnOracion(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const fragmento = text.slice(0, maxChars)
  // Buscar el último fin de oración antes del límite
  const ultimoFin = Math.max(
    fragmento.lastIndexOf('.'),
    fragmento.lastIndexOf('!'),
    fragmento.lastIndexOf('?')
  )
  if (ultimoFin > maxChars * 0.5) return text.slice(0, ultimoFin + 1).trimEnd()
  // Si no hay fin de oración, cortar en el último espacio
  const ultimoEspacio = fragmento.lastIndexOf(' ')
  if (ultimoEspacio > 0) return text.slice(0, ultimoEspacio).trimEnd()
  return fragmento.trimEnd()
}

function stripThinkingBlocks(text: string): string {
  return text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim()
}

export function sanitizarRespuestaModelo(raw: string): string {
  const sinThinking = stripThinkingBlocks(raw)
  const compact = compactWhitespace(sinThinking)
  if (!compact) return ''
  const noRepeats = removeRepeatedLines(compact)
  return truncarEnOracion(noRepeats, MAX_CHARS)
}

export interface ChequeoCoherenciaRubro {
  texto: string
  verticalLead: VerticalId
  intrusa: VerticalId | null
  ok: boolean
}

/**
 * Capa 2 — auditoría de coherencia de rubro.
 * Sanitiza la respuesta y detecta si menciona léxico EXCLUSIVO de una vertical
 * distinta a la del lead. No reemplaza el texto: el caller decide si regenera
 * con prompt endurecido o usa un fallback seguro.
 */
export function auditarCoherenciaRubro(
  raw: string,
  rubro: string,
  descripcion?: string | null
): ChequeoCoherenciaRubro {
  const texto = sanitizarRespuestaModelo(raw)
  const verticalLead = detectarVertical(rubro ?? '', descripcion)
  if (!texto) {
    return { texto: '', verticalLead, intrusa: null, ok: false }
  }
  const intrusa = detectarVerticalIntrusa(texto, verticalLead)
  return { texto, verticalLead, intrusa, ok: intrusa === null }
}

/**
 * Construye una instrucción de regeneración para el segundo intento del LLM.
 * Se inyecta como mensaje `user` adicional cuando detectamos mezcla de rubro.
 */
export function instruccionRegeneracion(params: {
  verticalLead: VerticalId
  intrusa: VerticalId
  textoAnterior: string
  rubroLiteral: string
  nombre: string
}): string {
  const permitidas = terminosPermitidos(params.verticalLead)
  const prohibidas = terminosProhibidos(params.verticalLead)
  const lineas: string[] = [
    `La respuesta anterior mezcló rubros: el lead es "${params.nombre}" — vertical ${labelVertical(params.verticalLead)} (rubro literal: "${params.rubroLiteral}"), pero tu mensaje usó vocabulario de ${labelVertical(params.intrusa)}.`,
    '',
    'Mensaje a corregir (NO lo repitas tal cual):',
    `"""${params.textoAnterior}"""`,
    '',
    'Regenerá la respuesta respetando estas reglas, sin excepciones:',
    `- Mantenete 100% dentro de la vertical "${labelVertical(params.verticalLead)}".`,
  ]
  if (permitidas.length) {
    lineas.push(`- Usá vocabulario natural de ese rubro: ${permitidas.join(', ')}.`)
  }
  if (prohibidas.length) {
    lineas.push(
      `- PROHIBIDO usar estos términos (son de otras verticales): ${prohibidas.join(', ')}.`
    )
  }
  lineas.push(
    '- Si el cliente respondió algo corto o ambiguo, preguntá algo específico al rubro correcto.',
    '- Respetá el mismo tono, longitud y formato WhatsApp (máx 600 caracteres, sin emojis, sin Markdown).'
  )
  return lineas.join('\n')
}

/**
 * Fallback de último recurso si la regeneración también falla.
 * Mensaje neutro que no asume ninguna vertical específica más allá de la del lead.
 */
export function fallbackSeguroPorVertical(verticalLead: VerticalId, nombre: string): string {
  const safeNombre = (nombre || '').trim() || 'tu negocio'
  switch (verticalLead) {
    case 'moda':
      return `Para ${safeNombre}, ¿preferís que el boceto priorice catálogo, talles o cómo mostrar envíos? Te lo armo alineado a la marca, sin compromiso.`
    case 'gastronomia':
      return `Para ${safeNombre}, ¿el foco va por carta online, reservas o pedidos delivery? Con eso te armo el boceto sin compromiso.`
    case 'fitness':
      return `Para ${safeNombre}, ¿priorizamos clases, planes o reservas en el boceto? Te lo preparo a medida, sin compromiso.`
    case 'salud':
      return `Para ${safeNombre}, ¿querés que el boceto muestre turnos, especialidades o ambos? Te lo armo sin compromiso.`
    case 'estetica':
      return `Para ${safeNombre}, ¿el boceto apunta a turnos online, catálogo de servicios o ambos? Te lo preparo sin compromiso.`
    case 'inmobiliaria':
      return `Para ${safeNombre}, ¿el boceto arranca por fichas de propiedades y filtros de búsqueda? Te lo armo sin compromiso.`
    case 'educacion':
      return `Para ${safeNombre}, ¿priorizamos cursos con inscripción online o info institucional? Te lo preparo sin compromiso.`
    case 'servicios_pro':
      return `Para ${safeNombre}, ¿el boceto muestra áreas de trabajo y formulario de contacto? Te lo armo sin compromiso.`
    case 'eventos':
      return `Para ${safeNombre}, ¿el boceto va por galería de eventos y cotizaciones online? Te lo preparo sin compromiso.`
    case 'generico':
    default:
      return `Contame un poco más de ${safeNombre}: ¿qué tipo de negocio es y qué te gustaría que la web priorice? Con eso te armo el boceto.`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Detector de "boceto-bombing": el LLM cae en el script de "te mando el boceto"
// cuando el último mensaje del cliente NO daba contexto para hacerlo.
// ─────────────────────────────────────────────────────────────────────────────

const BOCETO_PITCH_MARKERS = [
  'te mando el boceto',
  'te lo mando en menos',
  'menos de 24 horas',
  'menos de 24hs',
  'menos de 24 hs',
  'ya tengo lo que necesito',
  'tengo lo que necesito',
  'te lo armo en',
  'te lo preparo en',
  'te preparo el boceto',
  'avancemos con el boceto',
]

const ANTI_PITCH_USER_MARKERS = [
  // wrong target
  'no tengo negocio',
  'no es mi negocio',
  'no soy el dueno',
  'no soy el dueño',
  'no soy la duena',
  'no soy la dueña',
  'numero equivocado',
  'número equivocado',
  'te equivocaste',
  'no me dedico',
  'soy un particular',
  'soy particular',
  // business closed
  'cerre el negocio',
  'cerré el negocio',
  'cerramos el negocio',
  'cerre el local',
  'cerré el local',
  'cerramos el local',
  'ya no tengo el negocio',
  'ya no tengo el local',
  'me jubile',
  'me jubilé',
  'lo vendi',
  'lo vendí',
  // suspicion / hostility
  'de donde sacaste',
  'de dónde sacaste',
  'quien sos',
  'quién sos',
  'porque me escribis',
  'por qué me escribis',
  'por que me escribis',
  'sos la tercera',
  'sos la cuarta',
  'sos la quinta',
  'la tercera persona',
  'la cuarta persona',
  'la quinta persona',
  'dejame tranquilo',
  'déjame tranquilo',
  'dejenme tranquilo',
  'déjenme tranquilo',
  'no me escriban',
  'no escriban mas',
  'no escriban más',
  // family relay
  'es de mi hermana',
  'es de mi hermano',
  'es de mi mama',
  'es de mi mamá',
  'es de un familiar',
]

function normalizar(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface BocetoBombingCheck {
  esBocetoBombing: boolean
  marcadorPitch: string | null
  marcadorUsuario: string | null
}

/**
 * Detecta si la respuesta del LLM cae en el script de "te mando el boceto"
 * cuando el último mensaje del cliente contiene señales que prohíben pitchear.
 * No reemplaza el texto: el caller decide regenerar o usar fallback.
 */
export function detectarBocetoBombing(
  respuestaLlm: string,
  ultimoMensajeCliente: string
): BocetoBombingCheck {
  const r = normalizar(respuestaLlm)
  const u = normalizar(ultimoMensajeCliente)

  const marcadorPitch = BOCETO_PITCH_MARKERS.find(m => r.includes(m)) ?? null
  if (!marcadorPitch) {
    return { esBocetoBombing: false, marcadorPitch: null, marcadorUsuario: null }
  }

  const marcadorUsuario =
    ANTI_PITCH_USER_MARKERS.find(m => u.includes(m)) ?? null
  if (!marcadorUsuario) {
    return { esBocetoBombing: false, marcadorPitch, marcadorUsuario: null }
  }

  return { esBocetoBombing: true, marcadorPitch, marcadorUsuario }
}

/**
 * Fallback seguro cuando se detecta boceto-bombing.
 * Devuelve una respuesta neutra y honesta apropiada al marcador del usuario.
 */
export function fallbackPostBocetoBombing(marcadorUsuario: string): string {
  const m = marcadorUsuario.toLowerCase()
  if (
    m.includes('no tengo negocio') ||
    m.includes('no soy') ||
    m.includes('numero equivocado') ||
    m.includes('número equivocado') ||
    m.includes('te equivocaste') ||
    m.includes('soy particular') ||
    m.includes('soy un particular') ||
    m.includes('no me dedico')
  ) {
    return 'Uh, disculpá la molestia. Tu número quedó por error en una base que armé buscando comercios — te borro ahora. Que tengas buen día.'
  }
  if (
    m.includes('cerre') ||
    m.includes('cerré') ||
    m.includes('cerramos') ||
    m.includes('jubil') ||
    m.includes('vendi') ||
    m.includes('vendí')
  ) {
    return 'No tenía idea, disculpá. Te borro de la base entonces. Éxitos en lo que sigas.'
  }
  if (
    m.includes('de donde sacaste') ||
    m.includes('de dónde sacaste') ||
    m.includes('quien sos') ||
    m.includes('quién sos') ||
    m.includes('porque me escribis') ||
    m.includes('por qué me escribis') ||
    m.includes('por que me escribis')
  ) {
    return 'Tranqui, te escribí porque tu negocio aparecía en Google Maps con la zona y rubro que trabajo. Si no te interesa lo borro y listo.'
  }
  if (m.includes('sos la') || m.includes('persona') || m.includes('dejame') || m.includes('déjame') || m.includes('dejenme') || m.includes('déjenme') || m.includes('no escriban') || m.includes('no me escriban')) {
    return 'Te entiendo, perdón por la insistencia. Te saco de la base.'
  }
  if (m.includes('es de mi') || m.includes('es de un familiar') || m.includes('es de una amiga') || m.includes('es de un amigo')) {
    return 'Dale, gracias. Si querés mostrale la propuesta de arriba, sin compromiso. Cuando puedan lo charlamos.'
  }
  // fallback genérico — preguntar antes de pitchear
  return 'Dale, contame un poco más así te respondo bien. ¿De qué tipo de negocio se trata?'
}

/**
 * Compatibilidad retro: mantiene el flujo viejo para call-sites que todavía
 * no implementaron la regeneración. Sanitiza + aplica fallback si detecta
 * intrusión de vertical.
 */
export function sanitizarYCoherenciaRubro(
  raw: string,
  rubro: string,
  descripcion?: string | null,
  nombre?: string
): string {
  const chequeo = auditarCoherenciaRubro(raw, rubro, descripcion)
  if (!chequeo.texto) return ''
  if (chequeo.ok) return chequeo.texto
  return fallbackSeguroPorVertical(chequeo.verticalLead, nombre ?? '')
}
