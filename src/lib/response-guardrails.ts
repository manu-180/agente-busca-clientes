const MAX_CHARS = 300

/** Marcadores de vertical “gimnasio” que suelen alucinarse cuando el lead es otro rubro */
const PATRON_VERTICAL_GYM =
  /\b(gimnasio|gym|reserva(?:s)? de clases|clases grupales|membres[ií]a|socios?)\b/i

const PATRON_RUBRO_MODA_TIENDA =
  /\b(moda|boutique|indumentaria|ropa(?:\s+femenina)?|vestidos?|tienda(?:\s+de)?\s+ropa|e-?commerce|comercio\s+textil)\b/i

/**
 * Si el rubro es moda/tienda y el modelo respondió con vocabulario de gimnasio, reemplaza por un mensaje seguro.
 * Defensa en profundidad ante historial incompleto o sesgo de ejemplos en apex_info.
 */
export function corregirMezclaVerticalRubro(
  texto: string,
  rubro: string,
  descripcion?: string | null
): string {
  const ref = `${rubro ?? ''} ${descripcion ?? ''}`
  if (!PATRON_RUBRO_MODA_TIENDA.test(ref)) return texto
  if (!PATRON_VERTICAL_GYM.test(texto)) return texto
  return (
    '¡Genial! Para tu tienda, ¿preferís que el boceto priorice catálogo, talles o cómo mostrar envíos? ' +
    'Te lo preparo alineado a tu marca, sin compromiso.'
  )
}

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

/** Tras sanitizar, aplica corrección de mezcla de rubros si hace falta. */
export function sanitizarYCoherenciaRubro(
  raw: string,
  rubro: string,
  descripcion?: string | null
): string {
  const base = sanitizarRespuestaModelo(raw)
  if (!base) return ''
  return corregirMezclaVerticalRubro(base, rubro, descripcion)
}
