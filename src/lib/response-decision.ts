export type ConversationRole = 'agente' | 'cliente'

export type DecisionAction =
  | 'no_reply'
  | 'micro_ack'
  | 'full_reply'
  | 'handoff_human'
  | 'close_conversation'
  | 'confirm_close'

export type DecisionReason =
  | 'empty'
  | 'emoji_only'
  | 'opt_out'
  | 'human_handoff_request'
  | 'explicit_question_or_request'
  | 'conversation_closing'
  | 'low_signal_ack'
  | 'simple_greeting'
  | 'default_full_reply'
  | 'commit_signal'

export interface ConversationDecision {
  action: DecisionAction
  reason: DecisionReason
  confidence: number
  closeConversation?: boolean
  disableAgent?: boolean
  eventName: string
}

export interface DecisionConfig {
  decisionEngineEnabled: boolean
  emojiNoReplyEnabled: boolean
  conversationAutoCloseEnabled: boolean
}

export interface DecisionInput {
  message: string
  history?: Array<{ rol: ConversationRole; mensaje: string }>
  config: DecisionConfig
}

const OPT_OUT_PHRASES = [
  'no me interesa',
  'no gracias',
  'no quiero',
  'deja de escribir',
  'dejá de escribir',
  'no molestes',
  'no me escribas',
  'basta',
  'stop',
  'cancelar',
]

const HUMAN_HANDOFF_PHRASES = [
  'humano',
  'persona',
  'asesor',
  'agente',
  'hablar con alguien',
  'quiero hablar con',
]

const LOW_SIGNAL_ACKS = new Set([
  'ok',
  'oka',
  'okey',
  'dale',
  'gracias',
  'genial',
  'perfecto',
  'perfecta',
  'listo',
  'joya',
  'bien',
  'buenisimo',
  'buenísimo',
  'si',
  'sí',
])

const CLOSING_PHRASES = [
  'gracias igual',
  'muchas gracias',
  'te aviso cualquier cosa',
  'te escribo despues',
  'te escribo después',
  'todo bien',
  'hasta luego',
  'nos vemos',
  'chau',
  'chao',
  'adios',
  'adiós',
]

const GREETINGS = new Set(['hola', 'buenas', 'buen dia', 'buen día', 'hello'])

// Señales de compromiso real — el cliente ya decidió, solo necesita el próximo paso
const COMMIT_SIGNALS = [
  'arranquemos',
  'arrancamos',
  'lo quiero',
  'me lo quedo',
  'lo tomo',
  'lo tomamos',
  'cerramos',
  'trato hecho',
  'como pago',
  'cómo pago',
  'como pagamos',
  'cómo pagamos',
  'a que cuenta',
  'a qué cuenta',
  'cuando empezamos',
  'cuándo empezamos',
  'cuando arrancamos',
  'cuándo arrancamos',
  'dale arrancamos',
  'dale arranquemos',
  'si arranquemos',
  'sí arranquemos',
  'si arrancamos',
  'sí arrancamos',
  'hacemos trato',
  'quiero empezar',
  'cuando comenzamos',
  'cuándo comenzamos',
]

// Palabras clave en el último mensaje del agente que indican una propuesta/oferta
const PROPOSAL_KEYWORDS = [
  'boceto',
  'reunion',
  'reunión',
  'presupuesto',
  'propuesta',
  'llamada',
  'coordinamos',
  'coordinar',
  'agendar',
  'mostrarte',
  'mostrate',
  'te mando',
  'te paso',
  'avanzamos',
  'sin compromiso',
  'lo armamos',
  'te preparo',
  'arrancamos',
  'empezamos',
]

// Detecta si un low_signal_ack ("dale", "ok") es una respuesta a una propuesta del agente
function isCommitToProposal(
  normalized: string,
  history?: Array<{ rol: ConversationRole; mensaje: string }>
): boolean {
  if (!LOW_SIGNAL_ACKS.has(normalized)) return false
  if (!history || history.length === 0) return false

  const lastAgentMsg = [...history].reverse().find(h => h.rol === 'agente')
  if (!lastAgentMsg) return false

  const lastAgent = lastAgentMsg.mensaje
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  return PROPOSAL_KEYWORDS.some(kw => lastAgent.includes(kw))
}

function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isEmojiOrSymbolOnly(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (trimmed.includes('?')) return false
  if (/[A-Za-z0-9]/.test(trimmed)) return false
  const compact = trimmed.replace(/\s+/g, '')
  if (!compact) return false
  const hasEmojiSurrogatePair = /[\uD83C-\uDBFF][\uDC00-\uDFFF]/.test(compact)
  const onlySymbols = /^[^A-Za-z0-9]+$/.test(compact)
  return hasEmojiSurrogatePair || onlySymbols
}

function includesAny(text: string, phrases: string[]): boolean {
  return phrases.some(phrase => text.includes(phrase))
}

function isQuestionOrActionable(text: string): boolean {
  if (text.includes('?')) return true
  return /(cuanto|precio|presupuesto|cuando|como|agend|pasame|enviame|mandame|quiero|necesito|pueden|podrian)/.test(
    text
  )
}

function isLowSignalAck(text: string): boolean {
  return LOW_SIGNAL_ACKS.has(text)
}

function isSimpleGreeting(text: string): boolean {
  return GREETINGS.has(text)
}

export function decidirRespuestaConversacional(input: DecisionInput): ConversationDecision {
  const normalized = normalize(input.message)

  if (!normalized) {
    return {
      action: 'no_reply',
      reason: 'empty',
      confidence: 1,
      eventName: 'no_reply_empty',
    }
  }

  if (includesAny(normalized, OPT_OUT_PHRASES)) {
    return {
      action: 'close_conversation',
      reason: 'opt_out',
      confidence: 0.99,
      closeConversation: true,
      disableAgent: true,
      eventName: 'conversation_opt_out',
    }
  }

  if (includesAny(normalized, HUMAN_HANDOFF_PHRASES)) {
    return {
      action: 'handoff_human',
      reason: 'human_handoff_request',
      confidence: 0.95,
      eventName: 'handoff_human_request',
    }
  }

  if (!input.config.decisionEngineEnabled) {
    return {
      action: 'full_reply',
      reason: 'default_full_reply',
      confidence: 0.5,
      eventName: 'decision_engine_bypassed',
    }
  }

  if (input.config.emojiNoReplyEnabled && isEmojiOrSymbolOnly(input.message)) {
    return {
      action: 'no_reply',
      reason: 'emoji_only',
      confidence: 0.98,
      eventName: 'no_reply_emoji',
    }
  }

  // Señal de compromiso explícita → confirm_close (respuesta mínima de cierre)
  if (includesAny(normalized, COMMIT_SIGNALS)) {
    return {
      action: 'confirm_close',
      reason: 'commit_signal',
      confidence: 0.92,
      closeConversation: true,
      eventName: 'confirm_close_commit_signal',
    }
  }

  if (isQuestionOrActionable(normalized)) {
    return {
      action: 'full_reply',
      reason: 'explicit_question_or_request',
      confidence: 0.88,
      eventName: 'full_reply_actionable',
    }
  }

  if (input.config.conversationAutoCloseEnabled && includesAny(normalized, CLOSING_PHRASES)) {
    return {
      action: 'close_conversation',
      reason: 'conversation_closing',
      confidence: 0.85,
      closeConversation: true,
      eventName: 'conversation_closed_soft',
    }
  }

  // Low-signal ack que responde a una propuesta del agente → confirm_close en vez de silencio
  if (isCommitToProposal(normalized, input.history)) {
    return {
      action: 'confirm_close',
      reason: 'commit_signal',
      confidence: 0.85,
      closeConversation: true,
      eventName: 'confirm_close_proposal_ack',
    }
  }

  if (isLowSignalAck(normalized)) {
    return {
      action: 'no_reply',
      reason: 'low_signal_ack',
      confidence: 0.9,
      eventName: 'no_reply_low_signal',
    }
  }

  if (isSimpleGreeting(normalized)) {
    return {
      action: 'micro_ack',
      reason: 'simple_greeting',
      confidence: 0.75,
      eventName: 'micro_ack_greeting',
    }
  }

  return {
    action: 'full_reply',
    reason: 'default_full_reply',
    confidence: 0.7,
    eventName: 'full_reply_default',
  }
}
