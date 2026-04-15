import Anthropic from '@anthropic-ai/sdk'
import { SYSTEM_PROMPT_FOLLOWUP } from '@/lib/prompts'
import type { Lead } from '@/types'

const MAX_CHARS = 150

export async function generarMensajeFollowupClaude(lead: Lead, historialBreve: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[FOLLOWUP] Falta ANTHROPIC_API_KEY')
    return null
  }

  const client = new Anthropic({ apiKey })
  const userContent = `Lead:
- Nombre / negocio: ${lead.nombre}
- Rubro: ${lead.rubro}
- Zona: ${lead.zona}
- Origen: ${lead.origen}

Últimos mensajes (contexto):
${historialBreve || '(sin historial)'}

Generá el follow-up ahora.`

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      system: SYSTEM_PROMPT_FOLLOWUP,
      messages: [{ role: 'user', content: userContent }],
    })

    const texto = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
    if (!texto) return null

    if (texto.length > MAX_CHARS) {
      return texto.slice(0, MAX_CHARS - 1).trimEnd() + '…'
    }
    return texto
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[FOLLOWUP] Error Claude:', msg)
    return null
  }
}
