import {
  decidirRespuestaConversacional,
  type DecisionConfig,
} from '@/lib/response-decision'

const config: DecisionConfig = {
  decisionEngineEnabled: true,
  emojiNoReplyEnabled: true,
  conversationAutoCloseEnabled: true,
}

function decidir(message: string, history: any[] = []) {
  return decidirRespuestaConversacional({ message, history, config })
}

describe('wrong_target detection', () => {
  it('detecta "no tengo negocio"', () => {
    const d = decidir('Hola, no tengo negocio.')
    expect(d.action).toBe('apologize_wrong_target')
    expect(d.reason).toBe('wrong_target')
    expect(d.disableAgent).toBe(true)
    expect(d.closeConversation).toBe(true)
  })

  it('detecta "no soy la dueña"', () => {
    const d = decidir('Te equivocaste, no soy la dueña.')
    expect(d.action).toBe('apologize_wrong_target')
  })

  it('detecta "número equivocado"', () => {
    const d = decidir('Tenés el número equivocado.')
    expect(d.action).toBe('apologize_wrong_target')
  })

  it('detecta "no soy el dueño"', () => {
    const d = decidir('Mira, yo no soy el dueño del local.')
    expect(d.action).toBe('apologize_wrong_target')
  })

  it('caso real Viva la Pepa: "podes decir de dónde sacaste mí número sos la tercera persona que me lo oferta, no tengo negocio"', () => {
    const d = decidir(
      'Hola, podes decir de dónde sacaste mí número sos la tercera persona que me lo oferta, no tengo negocio'
    )
    expect(d.action).toBe('apologize_wrong_target')
    expect(d.disableAgent).toBe(true)
  })
})

describe('business_closed detection', () => {
  it('detecta "cerré el negocio"', () => {
    const d = decidir('Cerré el negocio hace meses, ya no estoy con eso.')
    expect(d.action).toBe('apologize_business_closed')
    expect(d.disableAgent).toBe(true)
  })

  it('detecta "vendí el negocio"', () => {
    const d = decidir('Vendí el negocio en febrero.')
    expect(d.action).toBe('apologize_business_closed')
  })

  it('detecta "ya no tengo el local"', () => {
    const d = decidir('Ya no tengo el local, gracias igual.')
    expect(d.action).toBe('apologize_business_closed')
  })
})

describe('family_relay detection', () => {
  it('detecta "es de mi hermana"', () => {
    const d = decidir('Es de mi hermana el local, le digo igual.')
    expect(d.action).toBe('family_relay')
  })

  it('detecta "es de mi marido"', () => {
    const d = decidir('Es de mi marido. Le aviso.')
    // wrong_target NO debería triggerear porque "no soy" no aparece;
    // family_relay sí.
    expect(d.action).toBe('family_relay')
  })
})

describe('source_question detection (sin negar negocio)', () => {
  it('detecta "de dónde sacaste mi número" sin combinarlo con wrong_target', () => {
    const d = decidir('De dónde sacaste mi número?')
    expect(d.action).toBe('explain_source')
  })

  it('si el mensaje también niega el negocio, gana wrong_target', () => {
    const d = decidir(
      'De dónde sacaste mi número? No tengo negocio.'
    )
    expect(d.action).toBe('apologize_wrong_target')
  })
})

describe('opt_out se mantiene', () => {
  it('"no me interesa" sigue funcionando', () => {
    const d = decidir('No me interesa, gracias.')
    expect(d.action).toBe('close_conversation')
    expect(d.disableAgent).toBe(true)
  })

  it('"no escriban más" se detecta', () => {
    const d = decidir('No escriban más por favor.')
    expect(d.action).toBe('close_conversation')
  })
})

describe('flujos no afectados', () => {
  it('"dale arranquemos" sigue siendo confirm_close', () => {
    const d = decidir('Dale arranquemos.')
    expect(d.action).toBe('confirm_close')
  })

  it('una pregunta de precio sigue full_reply', () => {
    const d = decidir('¿Cuánto sale una web simple?')
    expect(d.action).toBe('full_reply')
  })

  it('saludo simple sigue micro_ack', () => {
    const d = decidir('Hola')
    expect(d.action).toBe('micro_ack')
  })

  it('gatekeeper formal sigue gatekeeper_relay', () => {
    const d = decidir('Lo voy a pasar al sector correspondiente.')
    expect(d.action).toBe('gatekeeper_relay')
  })
})
