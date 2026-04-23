import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_CHAT_MODEL } from '@/lib/anthropic-model'

export type Intent =
  | 'interested'        // muestra interés, quiere saber más o avanzar
  | 'declined'          // rechaza explícitamente, no le interesa
  | 'owner_takeover'    // el dueño dice que continúa él/ella, o pide que el bot pare
  | 'pricing_question'  // pregunta cuánto cuesta
  | 'what_includes'     // pregunta qué incluye el boceto o el servicio
  | 'wants_call'        // quiere coordinar una llamada
  | 'out_of_scope'      // mensaje completamente ajeno (reclamo, spam, tema personal)
  | 'neutral'           // respuesta ambigua, continúa conversando sin decisión clara

export interface IntentResult {
  intent: Intent
  confidence: 'high' | 'medium' | 'low'
  reasoning: string
}

const INTENT_TOOL: Anthropic.Tool = {
  name: 'classify_intent',
  description: 'Clasifica el intent del mensaje entrante en la conversación de outreach de Instagram',
  input_schema: {
    type: 'object' as const,
    properties: {
      intent: {
        type: 'string',
        enum: [
          'interested',
          'declined',
          'owner_takeover',
          'pricing_question',
          'what_includes',
          'wants_call',
          'out_of_scope',
          'neutral',
        ],
        description: 'El intent clasificado',
      },
      confidence: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: 'Nivel de confianza en la clasificación',
      },
      reasoning: {
        type: 'string',
        description: 'Explicación breve de por qué se eligió ese intent (1 oración)',
      },
    },
    required: ['intent', 'confidence', 'reasoning'],
  },
}

const CLASSIFIER_SYSTEM = `Sos un clasificador de intents para conversaciones de outreach de Instagram de una agencia web argentina.
El agente le ofrece a boutiques de ropa un boceto gratuito de sitio web.

Clasificá el mensaje del usuario en el intent más preciso. Usá la herramienta classify_intent con el resultado.

Criterios:
- interested: dice "sí", "me interesa", "contame más", "¿cómo funciona?", preguntas generales sobre el servicio
- declined: "no gracias", "no me interesa", "no es para mí", "ya tenemos web", negativa clara
- owner_takeover: "te respondo yo", "soy la dueña", "no respondas más", "me encargo yo", indica que el humano toma control
- pricing_question: pregunta específicamente el precio, costo, cuánto sale, presupuesto
- what_includes: pregunta qué incluye el boceto, qué abarca el servicio, qué páginas tiene
- wants_call: quiere coordinar una llamada, reunión, videollamada
- out_of_scope: mensaje completamente ajeno a la propuesta (reclamo de pedido, spam, pregunta personal)
- neutral: saludo sin más, "ok", "entendido", respuesta ambigua que no es ni sí ni no`

export async function classifyIntent(
  message: string,
  conversationContext?: string,
): Promise<IntentResult> {
  const anthropic = new Anthropic()

  const userContent = conversationContext
    ? `Contexto de la conversación previa:\n${conversationContext}\n\nMensaje a clasificar:\n${message}`
    : message

  try {
    const response = await anthropic.messages.create({
      model: ANTHROPIC_CHAT_MODEL,
      max_tokens: 200,
      system: CLASSIFIER_SYSTEM,
      tools: [INTENT_TOOL],
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: userContent }],
    })

    const toolUse = response.content.find((b) => b.type === 'tool_use')
    if (toolUse && toolUse.type === 'tool_use') {
      const input = toolUse.input as IntentResult
      return {
        intent: input.intent ?? 'neutral',
        confidence: input.confidence ?? 'low',
        reasoning: input.reasoning ?? '',
      }
    }
  } catch (err) {
    console.error('[intent] classification error', err)
  }

  return { intent: 'neutral', confidence: 'low', reasoning: 'fallback' }
}
