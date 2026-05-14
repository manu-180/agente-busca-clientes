import {
  decidirRespuestaConversacional,
  lastAgentMessageWasClosing,
  type DecisionConfig,
} from '../response-decision'
import {
  detectarBocetoBombing,
  fallbackPostBocetoBombing,
} from '../response-guardrails'

const cfg: DecisionConfig = {
  decisionEngineEnabled: true,
  emojiNoReplyEnabled: true,
  conversationAutoCloseEnabled: true,
}

describe('decidirRespuestaConversacional — derivación a tercero', () => {
  it('"Quizás para mí no, pero para otra persona si" → family_relay', () => {
    const d = decidirRespuestaConversacional({
      message: 'Quizás para mí no, pero para otra persona si',
      config: cfg,
    })
    expect(d.action).toBe('family_relay')
    expect(d.reason).toBe('family_relay')
  })

  it('"no es para mí pero capaz para una amiga" → family_relay', () => {
    const d = decidirRespuestaConversacional({
      message: 'no es para mí pero capaz para una amiga',
      config: cfg,
    })
    expect(d.action).toBe('family_relay')
  })

  it('"para mi no, para un amigo si" → family_relay', () => {
    const d = decidirRespuestaConversacional({
      message: 'para mi no, para un amigo si',
      config: cfg,
    })
    expect(d.action).toBe('family_relay')
  })
})

describe('decidirRespuestaConversacional — variantes de business closed', () => {
  it('"ya no hay mas local" → business_closed', () => {
    const d = decidirRespuestaConversacional({
      message: 'ya no hay mas local',
      config: cfg,
    })
    expect(d.action).toBe('apologize_business_closed')
  })

  it('"esa marca ya no existe" → business_closed', () => {
    const d = decidirRespuestaConversacional({
      message: 'esa marca ya no existe!',
      config: cfg,
    })
    expect(d.action).toBe('apologize_business_closed')
  })

  it('"Fue un proyecto que ya finalizó" → business_closed', () => {
    const d = decidirRespuestaConversacional({
      message: 'Fue un proyecto que ya finalizó',
      config: cfg,
    })
    expect(d.action).toBe('apologize_business_closed')
  })
})

describe('decidirRespuestaConversacional — lock post-cierre', () => {
  it('mensaje neutral con conversationClosed=true → no_reply', () => {
    const d = decidirRespuestaConversacional({
      message: 'Saludos!',
      config: cfg,
      conversationClosed: true,
    })
    expect(d.action).toBe('no_reply')
    expect(d.reason).toBe('post_close_silence')
  })

  it('mensaje neutral con último mensaje del agente de cierre → no_reply', () => {
    const d = decidirRespuestaConversacional({
      message: 'Saludos!',
      config: cfg,
      history: [
        { rol: 'cliente', mensaje: 'cerré el local' },
        {
          rol: 'agente',
          mensaje:
            'No tenía idea, disculpá. Te borro de la base entonces. Éxitos en lo que sigas.',
        },
      ],
    })
    expect(d.action).toBe('no_reply')
    expect(d.reason).toBe('post_close_silence')
  })

  it('commit signal con conversationClosed=true → confirm_close (sí reabre)', () => {
    const d = decidirRespuestaConversacional({
      message: 'dale arranquemos',
      config: cfg,
      conversationClosed: true,
    })
    expect(d.action).toBe('confirm_close')
  })

  it('pregunta concreta con conversationClosed=true → full_reply (sí reabre)', () => {
    const d = decidirRespuestaConversacional({
      message: '¿cuánto sale una web?',
      config: cfg,
      conversationClosed: true,
    })
    expect(d.action).toBe('full_reply')
  })

  it('lastAgentMessageWasClosing reconoce mensaje de cierre', () => {
    expect(
      lastAgentMessageWasClosing([
        { rol: 'agente', mensaje: 'Te saco de la base. Perdón por la insistencia.' },
      ])
    ).toBe(true)
  })

  it('lastAgentMessageWasClosing devuelve false si el último msg del agente no es cierre', () => {
    expect(
      lastAgentMessageWasClosing([
        { rol: 'agente', mensaje: 'Te mando el boceto en menos de 24 horas.' },
      ])
    ).toBe(false)
  })
})

describe('decidirRespuestaConversacional — sanity (no regresiones)', () => {
  it('"Hola" sigue siendo simple_greeting', () => {
    const d = decidirRespuestaConversacional({ message: 'Hola', config: cfg })
    expect(d.action).toBe('micro_ack')
  })

  it('"dale arranquemos" sigue siendo commit_signal', () => {
    const d = decidirRespuestaConversacional({
      message: 'dale arranquemos',
      config: cfg,
    })
    expect(d.action).toBe('confirm_close')
    expect(d.reason).toBe('commit_signal')
  })

  it('"no me interesa" sigue siendo opt_out', () => {
    const d = decidirRespuestaConversacional({
      message: 'no me interesa',
      config: cfg,
    })
    expect(d.action).toBe('close_conversation')
    expect(d.disableAgent).toBe(true)
  })
})

describe('detectarBocetoBombing — nuevos marcadores', () => {
  it('detecta pitch tras "Quizás para mí no, pero para otra persona si"', () => {
    const bombing = detectarBocetoBombing(
      'Dale, ya tengo lo que necesito. En menos de 24 horas te mando el boceto.',
      'Quizás para mí no, pero para otra persona si'
    )
    expect(bombing.esBocetoBombing).toBe(true)
    expect(bombing.marcadorUsuario).toBeTruthy()
  })

  it('detecta pitch tras "esa marca ya no existe"', () => {
    const bombing = detectarBocetoBombing(
      'Buenísimo. En menos de 24 horas te mando el boceto.',
      'esa marca ya no existe'
    )
    expect(bombing.esBocetoBombing).toBe(true)
  })

  it('no marca como bombing si el cliente sí confirmó interés', () => {
    const bombing = detectarBocetoBombing(
      'Buenísimo. En menos de 24 horas te mando el boceto.',
      'sí, dale, mandame el boceto'
    )
    expect(bombing.esBocetoBombing).toBe(false)
  })
})

describe('fallbackPostBocetoBombing — respuestas apropiadas', () => {
  it('"para otra persona" → respuesta tipo derivación', () => {
    const fb = fallbackPostBocetoBombing('para otra persona')
    expect(fb.toLowerCase()).toMatch(/pasale|mostrale|sin compromiso/)
  })

  it('"ya no hay mas local" → respuesta de cierre business_closed', () => {
    const fb = fallbackPostBocetoBombing('ya no hay mas local')
    expect(fb.toLowerCase()).toMatch(/te borro|disculpá|éxitos/)
  })

  it('"proyecto que ya finalizó" → respuesta de cierre business_closed', () => {
    const fb = fallbackPostBocetoBombing('proyecto que ya finalizo')
    expect(fb.toLowerCase()).toMatch(/te borro|disculpá|éxitos/)
  })
})
