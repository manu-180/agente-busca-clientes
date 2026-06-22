import { construirBloqueBoceto, linkYaCompartido } from '@/lib/boceto-proactivo'

describe('linkYaCompartido', () => {
  const link = 'https://www.carta.it.com/r/lo-de-facu'

  it('detecta el link aunque varíe protocolo / www / mayúsculas / slash final', () => {
    expect(linkYaCompartido(link, ['te dejo cómo te quedó: https://www.carta.it.com/r/lo-de-facu'])).toBe(true)
    expect(linkYaCompartido(link, ['mirá: carta.it.com/r/lo-de-facu'])).toBe(true)
    expect(linkYaCompartido(link, ['HTTPS://WWW.CARTA.IT.COM/R/LO-DE-FACU'])).toBe(true)
    expect(linkYaCompartido(link, ['acá: https://www.carta.it.com/r/lo-de-facu/'])).toBe(true)
  })

  it('es false si nunca se mandó (incluido otro slug)', () => {
    expect(linkYaCompartido(link, [])).toBe(false)
    expect(linkYaCompartido(link, ['hola, te paso info'])).toBe(false)
    expect(linkYaCompartido(link, ['carta.it.com/r/otro-local'])).toBe(false)
  })
})

describe('construirBloqueBoceto', () => {
  const link = 'https://www.carta.it.com/r/lo-de-facu'

  it('sin pagina_url → string vacío', () => {
    expect(construirBloqueBoceto(null)).toBe('')
    expect(construirBloqueBoceto('')).toBe('')
    expect(construirBloqueBoceto(undefined)).toBe('')
  })

  it('con pagina_url y sin compartir aún → bloque PROACTIVO (genera el momento, no cerrar sin mostrar)', () => {
    const b = construirBloqueBoceto(link, [])
    expect(b).toContain('[BOCETO]')
    expect(b).toContain(link)
    expect(b).toContain('GENERÁ EL MOMENTO')
    expect(b).toContain('NO termines la conversación')
    expect(b).toContain('EXACTO')
    // contempla señales rojas y la excepción de delegación
    expect(b).toContain('número equivocado')
    expect(b).toContain('se lo paso')
  })

  it('normaliza un host *.vercel.app al dominio canónico con www', () => {
    const b = construirBloqueBoceto('https://carta-tawny-alpha.vercel.app/r/lo-de-facu', [])
    expect(b).toContain('https://www.carta.it.com/r/lo-de-facu')
    expect(b).not.toContain('vercel.app/r/')
  })

  it('si el link YA fue compartido → bloque dice no repetir (pero exige exactitud)', () => {
    const b = construirBloqueBoceto(link, ['te dejo cómo te quedó: ' + link])
    expect(b).toContain('YA se la compartiste')
    expect(b).toContain('NO la repitas')
    expect(b).toContain('EXACTA')
  })
})
