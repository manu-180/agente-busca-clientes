import {
  detectarVertical,
  detectarVerticalIntrusa,
  labelVertical,
  terminosPermitidos,
  terminosProhibidos,
  type VerticalId,
} from '@/lib/verticales'

const MAX_CHARS = 300

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

export function sanitizarRespuestaModelo(raw: string): string {
  const compact = compactWhitespace(raw)
  if (!compact) return ''
  const noRepeats = removeRepeatedLines(compact)
  if (noRepeats.length <= MAX_CHARS) return noRepeats
  return noRepeats.slice(0, MAX_CHARS).trimEnd()
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
    '- Respetá el mismo tono, longitud y formato WhatsApp (máx 300 caracteres, sin emojis, sin Markdown).'
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
      return `¡Genial! Para ${safeNombre}, ¿preferís que el boceto priorice catálogo, talles o cómo mostrar envíos? Te lo armo alineado a la marca, sin compromiso.`
    case 'gastronomia':
      return `¡Dale! Para ${safeNombre}, ¿el foco va por carta online, reservas o pedidos delivery? Con eso te armo el boceto sin compromiso.`
    case 'fitness':
      return `¡Buenísimo! Para ${safeNombre}, ¿priorizamos clases, planes o reservas en el boceto? Te lo preparo a medida, sin compromiso.`
    case 'salud':
      return `¡Perfecto! Para ${safeNombre}, ¿querés que el boceto muestre turnos, especialidades o ambos? Te lo armo sin compromiso.`
    case 'estetica':
      return `¡Dale! Para ${safeNombre}, ¿el boceto apunta a turnos online, catálogo de servicios o ambos? Te lo preparo sin compromiso.`
    case 'inmobiliaria':
      return `¡Buenísimo! Para ${safeNombre}, ¿el boceto arranca por fichas de propiedades y filtros? Te lo armo sin compromiso.`
    case 'educacion':
      return `¡Genial! Para ${safeNombre}, ¿priorizamos cursos con inscripción online o info institucional? Te lo preparo sin compromiso.`
    case 'servicios_pro':
      return `¡Dale! Para ${safeNombre}, ¿el boceto muestra áreas de trabajo y contacto? Te lo armo sin compromiso.`
    case 'eventos':
      return `¡Buenísimo! Para ${safeNombre}, ¿el boceto va por galería de eventos y cotizaciones online? Te lo preparo sin compromiso.`
    case 'generico':
    default:
      return `¡Dale! Contame un poco más de ${safeNombre}: ¿qué tipo de negocio es y qué te gustaría que la web priorice? Con eso te armo el boceto.`
  }
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
