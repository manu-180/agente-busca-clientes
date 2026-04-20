import Anthropic from '@anthropic-ai/sdk'
import { SYSTEM_PROMPT_FOLLOWUP } from '@/lib/prompts'
import {
  describeViolations,
  validateContinuationMessage,
} from '@/lib/message-guards'
import type { Lead } from '@/types'

const MAX_CHARS = 300
const MODEL = 'claude-sonnet-4-5'

export interface FollowupStage {
  /** Número de followups ya enviados antes de este (0 = primer followup). */
  followupsPrevios: number
  /** ¿Respondió el cliente al menos una vez? */
  clienteRespondioAlguna: boolean
  /** Texto del primer mensaje que APEX envió (para mantener coherencia). */
  mensajeInicialApex?: string | null
}

async function callClaude(
  client: Anthropic,
  system: string,
  userContent: string
): Promise<string> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 250,
    system,
    messages: [{ role: 'user', content: userContent }],
  })
  return response.content[0].type === 'text' ? response.content[0].text.trim() : ''
}

function truncate(text: string): string {
  if (text.length <= MAX_CHARS) return text
  return text.slice(0, MAX_CHARS - 1).trimEnd() + '…'
}

export async function generarMensajeFollowupClaude(
  lead: Lead,
  historialBreve: string,
  stage?: FollowupStage
): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[FOLLOWUP] Falta ANTHROPIC_API_KEY')
    return null
  }

  const client = new Anthropic({ apiKey })

  const stageInfo = stage
    ? `
Estado de la conversación:
- Followups previos enviados: ${stage.followupsPrevios}
- ¿El cliente respondió alguna vez?: ${stage.clienteRespondioAlguna ? 'sí' : 'no'}
- Este es el followup #${stage.followupsPrevios + 1} (máximo 2 permitidos).${stage.mensajeInicialApex ? `\n- Primer mensaje que APEX envió (para coherencia de oferta): "${stage.mensajeInicialApex.replace(/\n/g, ' ').slice(0, 200)}"` : ''}
`
    : ''

  const userContent = `Lead:
- Nombre / negocio: ${lead.nombre}
- Rubro: ${lead.rubro}
- Zona: ${lead.zona}
- Origen: ${lead.origen}
${stageInfo}
Últimos mensajes de esta conversación (el cliente YA SABE quién sos — no te presentes):
${historialBreve || '(sin historial previo)'}

Generá el follow-up ahora. Recordá: nada de "Hola", nada de "Soy Manuel / Soy de APEX", directo al valor.`

  try {
    let texto = await callClaude(client, SYSTEM_PROMPT_FOLLOWUP, userContent)
    if (!texto) return null

    let guard = validateContinuationMessage(texto)
    if (!guard.ok) {
      console.warn('[FOLLOWUP] Guard falló 1ra vez:', guard.violations.map(v => v.rule).join(','))
      const hardenedSystem = `${SYSTEM_PROMPT_FOLLOWUP}

<regeneracion_obligatoria>
La versión anterior del mensaje falló las reglas. Corregí EXACTAMENTE esto:
${describeViolations(guard.violations)}

Generá un mensaje nuevo que arranque directo con el contenido (sin "Hola", sin re-presentarte, sin meta-términos, sin emoji).
</regeneracion_obligatoria>`
      texto = await callClaude(client, hardenedSystem, userContent)
      guard = validateContinuationMessage(texto)
      if (!guard.ok) {
        console.error('[FOLLOWUP] Guard falló 2da vez:', guard.violations.map(v => v.rule).join(','))
        return null
      }
    }

    return truncate(texto)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[FOLLOWUP] Error Claude:', msg)
    return null
  }
}
