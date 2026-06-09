import {
  pareceMensajeAutomaticoNegocio,
  pareceMensajeBotConversacional,
  pareceMensajeAutomaticoCliente,
  clienteYaMandoAlgoNoAutomatico,
} from '@/lib/outbound-auto-reply'

// Caso real (screenshot 1): auto-reply institucional de una iglesia. Antes se
// escapaba al LLM y el agente se disculpaba "te equivoqué de contacto".
const MSG_IGLESIA = `¡Bendiciones! Gracias por tu mensaje.
Te pedimos que nos digas tu nombre y si tenes algún pedido de oración o consulta.
Te esperamos también si deseas participar de nuestras reuniones todos los viernes a partir de las 19:30 Hs. Y los domingos a las 10:30 Hs. En Federico Baez Nro. 3380 G. Catán. La entrada es libre y gratuita.
Los días sábados tenemos actividades especiales para los niños, adolescentes y jóvenes.`

// Caso real (screenshot 2): presentación/bio automática. Antes el LLM respondía
// con el boceto de APEX ("ya tengo lo que necesito").
const MSG_BIO = `Mi nombre es *Monica*  Cuento con una trayectoria sólida como *actriz, facilitadora, Acompañante Terapéutica (AT) y docente*, especializada en el desarrollo de grupos y organizaciones.
Mi labor como facilitadora se centra en optimizar la colaboración interna, mejorar procesos y guiar a los equipos hacia el cumplimiento de objetivos mediante una metodología neutral y dinámica. Modo de contratación: ( Sectores educativos, cultural, organismos, Salud y Empresas) También de forma particular y personalizada`

describe('outbound-auto-reply — primer mensaje automático/predefinido', () => {
  describe('casos reales que antes se escapaban al LLM', () => {
    it('detecta el auto-reply institucional (iglesia)', () => {
      expect(pareceMensajeAutomaticoNegocio(MSG_IGLESIA)).toBe(true)
      expect(pareceMensajeAutomaticoCliente(MSG_IGLESIA)).toBe(true)
    })

    it('detecta la presentación/bio ("Mi nombre es...")', () => {
      expect(pareceMensajeBotConversacional(MSG_BIO)).toBe(true)
      expect(pareceMensajeAutomaticoCliente(MSG_BIO)).toBe(true)
    })

    it('detecta auto-replies que se auto-declaran (automático / fuera de horario)', () => {
      expect(
        pareceMensajeAutomaticoCliente('Este es un mensaje automático. Tu mensaje es importante para nosotros.')
      ).toBe(true)
      expect(
        pareceMensajeAutomaticoCliente('Estamos fuera del horario de atención, te responderemos pronto.')
      ).toBe(true)
    })

    it('detecta una bio "Mi nombre es X…" aunque NO diga "Modo de contratación"', () => {
      // Path de presentación + marcadores de bio (no depende de la frase literal
      // "modo de contratación"). Fija el fix del flag de mayúscula inicial.
      const bio =
        'Mi nombre es Laura. Cuento con una amplia experiencia y trayectoria como profesora de yoga, especializada en clases grupales y particulares.'
      expect(pareceMensajeBotConversacional(bio)).toBe(true)
      expect(pareceMensajeAutomaticoCliente(bio)).toBe(true)
    })

    it('una bio NO cuenta como "el cliente ya mandó algo real"', () => {
      const historial = [
        { rol: 'agente', mensaje: 'Hola, te dejo la propuesta arriba...' },
        { rol: 'cliente', mensaje: MSG_BIO },
      ]
      expect(clienteYaMandoAlgoNoAutomatico(historial)).toBe(false)
    })
  })

  describe('anti falso-positivo: un comprador real NUNCA es "automático"', () => {
    const reales = [
      'Hola, me interesa. ¿Cuánto sale?',
      'Sí, dale, mandame el link',
      'Hola! Soy Carlos, tengo un taller de cerámica y me interesa, ¿sirve para mí?',
      'ok gracias',
      'No tengo taller, te equivocaste de número',
      'Buenas, vi tu mensaje. Contame un poco más',
    ]
    it.each(reales)('%s', m => {
      expect(pareceMensajeAutomaticoCliente(m)).toBe(false)
    })
  })

  describe('robustez del predicado unificado', () => {
    it('null / undefined / vacío → false', () => {
      expect(pareceMensajeAutomaticoCliente(null)).toBe(false)
      expect(pareceMensajeAutomaticoCliente(undefined)).toBe(false)
      expect(pareceMensajeAutomaticoCliente('')).toBe(false)
    })

    it('un mensaje humano entremezclado SÍ marca al cliente como real', () => {
      const historial = [
        { rol: 'cliente', mensaje: MSG_IGLESIA },
        { rol: 'cliente', mensaje: '¿Cuánto sale la web?' },
      ]
      expect(clienteYaMandoAlgoNoAutomatico(historial)).toBe(true)
    })
  })
})
