/**
 * Guards post-generación — detectan patrones inaceptables en mensajes
 * de continuación (followups y respuestas en conversaciones ya iniciadas).
 *
 * Si un mensaje falla el guard, el caller debe regenerar con un prompt endurecido
 * o aplicar un fallback. Esto complementa al system prompt: el prompt guía el comportamiento
 * correcto, y el guard es la red de seguridad cuando el modelo desliza de todas formas.
 */

export interface GuardViolation {
  rule: 'greeting' | 'self_intro' | 'meta_followup' | 'victim_phrase' | 'emoji'
  matched: string
}

export interface GuardResult {
  ok: boolean
  violations: GuardViolation[]
}

const GREETING_OPENERS = [
  /^\s*hola[\s!,.]/i,
  /^\s*hey[\s!,.]/i,
  /^\s*buenas(?:\s|[!,.])/i,
  /^\s*buen(?:\s+d[ií]a|as\s+tardes|as\s+noches)/i,
  /^\s*saludos[\s!,.]/i,
  /^\s*qu[eé]\s+tal[\s!,.]/i,
  /^\s*c[oó]mo\s+(?:est[aá]s|anda[sn]?|va)[\s!,.?]/i,
]

const SELF_INTRO_PATTERNS = [
  /\bsoy\s+manuel\b/i,
  /\bsoy\s+de\s+apex\b/i,
  /\bme\s+llamo\s+manuel\b/i,
  /\bmanuel\s+de\s+apex\b/i,
  /\bte\s+escribo\s+de(?:sde)?\s+apex\b/i,
  /\bte\s+contacto\s+de(?:sde)?\s+apex\b/i,
  /\bparte\s+del\s+equipo\s+de\s+apex\b/i,
]

const META_FOLLOWUP_PATTERNS = [
  /\brecordatorio\b/i,
  /\bhaciendo\s+seguimiento\b/i,
  /\bhacer\s+seguimiento\b/i,
  /\bhago\s+seguimiento\b/i,
  /\bfollow[-\s]?up\b/i,
  /\bte\s+contacto\s+nuevamente\b/i,
  /\bme\s+pongo\s+en\s+contacto\b/i,
]

const VICTIM_PATTERNS = [
  /\bcomo\s+no\s+tuve\s+respuesta\b/i,
  /\btodav[ií]a\s+no\s+me\s+respondiste\b/i,
  /\bsigo\s+esperando\b/i,
  /\bno\s+he\s+recibido\s+respuesta\b/i,
  /\bno\s+me\s+contestaste\b/i,
]

// Emoji detection without the `u` flag (for wider TS target compat):
// - Surrogate pair range covers supplementary-plane emojis (U+1F300..U+1FAFF).
// - BMP symbols U+2600..U+27BF.
const EMOJI_PATTERN = /[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]/

/**
 * Valida un mensaje en contexto de CONTINUACIÓN (no primer contacto).
 * Los mensajes de primer contacto permiten "Hola" y auto-presentación —
 * no corresponde pasarlos por este guard.
 */
export function validateContinuationMessage(text: string): GuardResult {
  const violations: GuardViolation[] = []
  const trimmed = text.trim()

  for (const re of GREETING_OPENERS) {
    if (re.test(trimmed)) {
      violations.push({ rule: 'greeting', matched: re.source })
      break
    }
  }

  for (const re of SELF_INTRO_PATTERNS) {
    const m = trimmed.match(re)
    if (m) {
      violations.push({ rule: 'self_intro', matched: m[0] })
      break
    }
  }

  for (const re of META_FOLLOWUP_PATTERNS) {
    const m = trimmed.match(re)
    if (m) {
      violations.push({ rule: 'meta_followup', matched: m[0] })
      break
    }
  }

  for (const re of VICTIM_PATTERNS) {
    const m = trimmed.match(re)
    if (m) {
      violations.push({ rule: 'victim_phrase', matched: m[0] })
      break
    }
  }

  if (EMOJI_PATTERN.test(trimmed)) {
    violations.push({ rule: 'emoji', matched: 'emoji' })
  }

  return { ok: violations.length === 0, violations }
}

/**
 * Intenta reparar un mensaje de continuación removiendo la primera oración si
 * es un saludo o re-presentación. Si la oración restante es "sustantiva" (>20 chars),
 * devuelve el texto reparado. Si no, devuelve null y el caller debe regenerar o descartar.
 *
 * Esta es la ruta de remediación "cheap": una llamada a Claude ya costó tiempo/dinero,
 * así que preferimos recortar cuando el resto del mensaje está bien.
 */
export function stripContinuationViolations(text: string): string | null {
  const trimmed = text.trim()
  if (validateContinuationMessage(trimmed).ok) return trimmed

  // Partir en oraciones respetando signos y saltos de línea.
  const sentences = trimmed.split(/(?<=[.!?])\s+|\n+/).filter(s => s.trim())
  if (sentences.length < 2) return null

  // Filtrar oraciones que contengan saludo o re-presentación en CUALQUIER posición.
  // Una oración se descarta si su única "razón de ser" es saludar o presentarse.
  // Mantenemos oraciones sustantivas aunque contengan algún patrón (raro).
  const kept = sentences.filter(s => {
    const r = validateContinuationMessage(s)
    if (r.ok) return true
    const soloProblemaEsIntroOSaludo = r.violations.every(
      v => v.rule === 'greeting' || v.rule === 'self_intro'
    )
    return !soloProblemaEsIntroOSaludo
  })

  if (kept.length === 0 || kept.length === sentences.length) return null

  const reparado = kept.join(' ').trim()
  if (reparado.length < 20) return null

  // Verificar que lo reparado ya no viole reglas.
  const finalCheck = validateContinuationMessage(reparado)
  if (!finalCheck.ok) return null

  // Capitalizar primera letra.
  return reparado[0].toUpperCase() + reparado.slice(1)
}

/**
 * Resumen legible de las violaciones para inyectar en un prompt de regeneración.
 * El modelo recibe este texto como feedback explícito de qué falló la primera vez.
 */
export function describeViolations(violations: GuardViolation[]): string {
  if (violations.length === 0) return ''
  const parts = violations.map(v => {
    switch (v.rule) {
      case 'greeting':
        return `- Arrancaste con un saludo ("${v.matched}"). En continuación NO se saluda de nuevo.`
      case 'self_intro':
        return `- Te re-presentaste ("${v.matched}"). El cliente ya sabe quién sos; el historial lo prueba.`
      case 'meta_followup':
        return `- Usaste un meta-término ("${v.matched}"). Está prohibido mencionar que esto es un followup/seguimiento/recordatorio.`
      case 'victim_phrase':
        return `- Usaste una frase victimista ("${v.matched}"). No corresponde reclamarle respuesta al cliente.`
      case 'emoji':
        return `- Incluiste emoji. Prohibido en todo contexto.`
    }
  })
  return parts.join('\n')
}
