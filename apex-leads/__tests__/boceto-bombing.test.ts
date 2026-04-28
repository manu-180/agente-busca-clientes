import {
  detectarBocetoBombing,
  fallbackPostBocetoBombing,
} from '@/lib/response-guardrails'

describe('detectarBocetoBombing', () => {
  it('detecta el caso real Viva la Pepa', () => {
    const userMsg =
      'Hola, podes decir de dónde sacaste mí número sos la tercera persona que me lo oferta, no tengo negocio'
    const llmResp =
      'Dale, ya tengo lo que necesito. En menos de 24 horas te mando el boceto para que lo veas, y si te gusta avanzamos.'
    const r = detectarBocetoBombing(llmResp, userMsg)
    expect(r.esBocetoBombing).toBe(true)
    expect(r.marcadorPitch).toBeTruthy()
    expect(r.marcadorUsuario).toBeTruthy()
  })

  it('no triggerea cuando el cliente acepta el boceto', () => {
    const userMsg = 'Dale, mandame el boceto, me interesa.'
    const llmResp = 'Buenísimo. En menos de 24 horas te mando el boceto.'
    expect(detectarBocetoBombing(llmResp, userMsg).esBocetoBombing).toBe(false)
  })

  it('triggerea cuando el cliente cerró el negocio y el LLM ofrece boceto', () => {
    const userMsg = 'Cerré el negocio hace 6 meses.'
    const llmResp = 'Igual te puedo armar un boceto en menos de 24 horas.'
    expect(detectarBocetoBombing(llmResp, userMsg).esBocetoBombing).toBe(true)
  })

  it('triggerea cuando el cliente pide explicación y el LLM pichtea', () => {
    const userMsg = '¿Quién sos? ¿De dónde sacaste mi número?'
    const llmResp =
      'Soy Manuel de APEX. Te lo armo en menos de 24 horas y te lo mando.'
    expect(detectarBocetoBombing(llmResp, userMsg).esBocetoBombing).toBe(true)
  })

  it('no triggerea si el LLM no pichtea boceto', () => {
    const userMsg = 'No tengo negocio.'
    const llmResp = 'Disculpá la molestia, te borro de la base.'
    expect(detectarBocetoBombing(llmResp, userMsg).esBocetoBombing).toBe(false)
  })
})

describe('fallbackPostBocetoBombing', () => {
  it('devuelve disculpa para wrong_target', () => {
    const txt = fallbackPostBocetoBombing('no tengo negocio')
    expect(txt.toLowerCase()).toContain('disculp')
  })

  it('devuelve disculpa para business_closed', () => {
    const txt = fallbackPostBocetoBombing('cerré el negocio')
    expect(txt.toLowerCase()).toMatch(/disculp|éxitos|exitos/)
  })

  it('devuelve explicación tranquila para source_question', () => {
    const txt = fallbackPostBocetoBombing('de dónde sacaste mi número')
    expect(txt.toLowerCase()).toMatch(/google maps|tranqui/)
  })

  it('devuelve disculpa por insistencia para hostilidad', () => {
    const txt = fallbackPostBocetoBombing('sos la cuarta persona')
    expect(txt.toLowerCase()).toMatch(/perdón|insistencia|saco/)
  })

  it('devuelve mensaje de family_relay', () => {
    const txt = fallbackPostBocetoBombing('es de mi hermana')
    expect(txt.toLowerCase()).toMatch(/mostrale|propuesta|sin compromiso/)
  })
})
