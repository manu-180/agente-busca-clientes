export type ConversationRole = 'agente' | 'cliente'

export type DecisionAction =
  | 'no_reply'
  | 'micro_ack'
  | 'full_reply'
  | 'handoff_human'
  | 'close_conversation'
  | 'confirm_close'
  | 'gatekeeper_relay'
  | 'apologize_wrong_target'
  | 'apologize_business_closed'
  | 'family_relay'
  | 'explain_source'

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
  | 'gatekeeper_response'
  | 'wrong_target'
  | 'business_closed'
  | 'family_relay'
  | 'source_question'

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
  'no escriban mas',
  'no escriban más',
  'sacame de la lista',
  'sácame de la lista',
  'borrame de la lista',
  'bórrame de la lista',
  'no me llames',
  'no llamen mas',
  'no llamen más',
]

// Cliente dice que no tiene negocio / no es el dueño / es el número equivocado.
// Estas frases son señal MUY fuerte: se cierra y desactiva agente con disculpa.
const WRONG_TARGET_PHRASES = [
  'no tengo negocio',
  'no tengo ningun negocio',
  'no tengo ningún negocio',
  'no es mi negocio',
  'no soy el dueno',
  'no soy el dueño',
  'no soy la duena',
  'no soy la dueña',
  'no soy duena',
  'no soy dueña',
  'no soy el responsable',
  'no soy la responsable',
  'numero equivocado',
  'número equivocado',
  'te equivocaste de numero',
  'te equivocaste de número',
  'se equivocaron de numero',
  'se equivocaron de número',
  'tenes el numero equivocado',
  'tenés el número equivocado',
  'no es mi rubro',
  'no me dedico a eso',
  'no me dedico a',
  'no tengo nada que ver',
  'soy un particular',
  'soy particular',
  'soy una particular',
  'no es mi local',
  'este no es mi',
  'no es mi tienda',
  'no es mi comercio',
]

// Cliente dice que el negocio cerró / ya no opera. Se cierra con disculpa.
const BUSINESS_CLOSED_PHRASES = [
  'cerre el negocio',
  'cerré el negocio',
  'cerramos el negocio',
  'cerre el local',
  'cerré el local',
  'cerramos el local',
  'cerre la tienda',
  'cerré la tienda',
  'cerramos la tienda',
  'ya no tengo el negocio',
  'ya no tengo el local',
  'ya no tengo la tienda',
  'ya no tengo el comercio',
  'ya no atiendo mas',
  'ya no atiendo más',
  'ya no trabajo mas',
  'ya no trabajo más',
  'el negocio cerro',
  'el negocio cerró',
  'el local cerro',
  'el local cerró',
  'esta cerrado',
  'está cerrado',
  'me jubile',
  'me jubilé',
  'lo vendi',
  'lo vendí',
  'vendi el negocio',
  'vendí el negocio',
]

// Familiar / conocido que dice "se lo paso", "le aviso" — pero NO es empleado/portero del negocio.
// Variante "blanda" del gatekeeper, con tono más cercano.
const FAMILY_RELAY_PHRASES = [
  'es de mi hermana',
  'es de mi hermano',
  'es de mi mama',
  'es de mi mamá',
  'es de mi papa',
  'es de mi papá',
  'es de mi pareja',
  'es de mi marido',
  'es de mi esposo',
  'es de mi esposa',
  'es de mi mujer',
  'es de mi hija',
  'es de mi hijo',
  'es de un familiar',
  'es de una amiga',
  'es de un amigo',
  'es de mi tia',
  'es de mi tía',
  'es de mi tio',
  'es de mi tío',
  'le digo a mi',
  'le aviso a mi',
  'le paso a mi',
  'se lo paso a mi',
]

// Cliente pregunta cómo conseguimos su número / por qué lo contactamos. Suele indicar
// sospecha o frustración. Si NO viene combinado con "no tengo negocio", se explica
// brevemente sin pitchear nada y se le deja a él la decisión de seguir.
const SOURCE_QUESTION_PHRASES = [
  'de donde sacaste mi numero',
  'de dónde sacaste mi número',
  'de donde sacaron mi numero',
  'de dónde sacaron mi número',
  'como conseguiste mi numero',
  'cómo conseguiste mi número',
  'como conseguieron mi numero',
  'cómo consiguieron mi número',
  'quien te dio mi numero',
  'quién te dio mi número',
  'quien les dio mi numero',
  'quién les dio mi número',
  'de donde me conoces',
  'de dónde me conoces',
  'de donde me conocen',
  'de dónde me conocen',
  'como llegaste a mi',
  'cómo llegaste a mi',
  'porque me escribis',
  'por qué me escribis',
  'por que me escribis',
  'porque me escriben',
  'por qué me escriben',
  'por que me escriben',
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

// Respuestas de portero/intermediario: alguien dice que va a pasar el mensaje a otro
const GATEKEEPER_PHRASES = [
  'lo envio al sector',
  'lo envío al sector',
  'lo envio a quien',
  'lo envío a quien',
  'te paso con',
  'te paso al',
  'lo paso al',
  'lo paso a ',
  'te derivo',
  'lo derivo',
  'le aviso',
  'se lo comento',
  'se lo hago saber',
  'se lo digo',
  'le paso el mensaje',
  'se lo paso',
  'lo voy a comentar',
  'voy a comentar',
  'te pongo en contacto',
  'se lo hare saber',
  'se lo haré saber',
  'se lo comunicare',
  'se lo comunicaré',
  'lo voy a pasar',
  'lo voy a derivar',
  'lo derivo',
  'al sector correspondiente',
  'quien corresponda',
  'a quien corresponda',
  'al encargado',
  'al responsable',
  'con el dueno',
  'con el dueño',
  'con la duena',
  'con la dueña',
]

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

  // Cliente dice que no tiene negocio / no es el dueño / número equivocado.
  // Cierra con disculpa y desactiva agente — no hay nada que vender acá.
  if (includesAny(normalized, WRONG_TARGET_PHRASES)) {
    return {
      action: 'apologize_wrong_target',
      reason: 'wrong_target',
      confidence: 0.97,
      closeConversation: true,
      disableAgent: true,
      eventName: 'conversation_wrong_target',
    }
  }

  // Cliente dice que cerró el negocio. Cierra con disculpa.
  if (includesAny(normalized, BUSINESS_CLOSED_PHRASES)) {
    return {
      action: 'apologize_business_closed',
      reason: 'business_closed',
      confidence: 0.95,
      closeConversation: true,
      disableAgent: true,
      eventName: 'conversation_business_closed',
    }
  }

  // Familiar / conocido relay (variante suave del gatekeeper).
  if (includesAny(normalized, FAMILY_RELAY_PHRASES)) {
    return {
      action: 'family_relay',
      reason: 'family_relay',
      confidence: 0.9,
      eventName: 'family_relay_detected',
    }
  }

  // Cliente pregunta de dónde sacamos su número (sin negar negocio).
  // Solo aplica si no se combina con un signal ya cubierto arriba.
  if (includesAny(normalized, SOURCE_QUESTION_PHRASES)) {
    return {
      action: 'explain_source',
      reason: 'source_question',
      confidence: 0.9,
      eventName: 'source_question_detected',
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

  if (includesAny(normalized, GATEKEEPER_PHRASES)) {
    return {
      action: 'gatekeeper_relay',
      reason: 'gatekeeper_response',
      confidence: 0.93,
      eventName: 'gatekeeper_relay_detected',
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
