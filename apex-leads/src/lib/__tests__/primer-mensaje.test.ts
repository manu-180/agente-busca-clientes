import { construirMensajePrimerContacto } from '@/lib/primer-mensaje'

const leadBase = {
  nombre: 'Pizzería Don José',
  rubro: 'pizzería',
  zona: 'Palermo',
  descripcion: '4,5 estrellas · 210 opiniones',
  pagina_url: 'https://ejemplo.vercel.app/r/don-jose',
}

describe('construirMensajePrimerContacto — mensaje default (APEX, anti-ban)', () => {
  it('NO incluye ningún link en el primer mensaje en frío (la palanca #1 anti-ban)', () => {
    const msg = construirMensajePrimerContacto(leadBase)
    expect(msg).not.toMatch(/https?:\/\//i)
    expect(msg.toLowerCase()).not.toContain('theapexweb')
    expect(msg).not.toContain('vercel.app')
    expect(msg).not.toContain('carta.it.com')
  })

  it('incluye un opt-out explícito (la gente responde en vez de reportar)', () => {
    const msg = construirMensajePrimerContacto(leadBase).toLowerCase()
    expect(msg).toMatch(/avisa|no insisto|no te escribo|no te molesto/)
  })

  it('cierra con una pregunta (conversación bidireccional = señal positiva)', () => {
    const msg = construirMensajePrimerContacto(leadBase)
    expect(msg.trimEnd().endsWith('?')).toBe(true)
  })

  it('personaliza con el nombre y la zona del negocio', () => {
    const msg = construirMensajePrimerContacto(leadBase)
    expect(msg).toContain('Pizzería Don José')
    expect(msg.toLowerCase()).toContain('palermo')
  })
})

describe('construirMensajePrimerContacto — con plantilla de proyecto', () => {
  it('interpola las variables de la plantilla ({{nombre}}, {{zona}})', () => {
    const msg = construirMensajePrimerContacto(leadBase, 'Hola {{nombre}} de {{zona}}, ¿todo bien?')
    expect(msg).toBe('Hola Pizzería Don José de Palermo, ¿todo bien?')
  })

  it('sigue soportando {{demo_url}} para las plantillas que lo usen (normalizado a carta.it.com)', () => {
    // El anti-ban "sin link" se aplica al mensaje default (APEX) y a editar las
    // plantillas en DB; el código mantiene el soporte de {{demo_url}} para quien lo use.
    const msg = construirMensajePrimerContacto(leadBase, 'Mirá tu demo: {{demo_url}}')
    expect(msg).toMatch(/^Mirá tu demo: https?:\/\//)
    expect(msg).toContain('www.carta.it.com/r/don-jose')
  })
})
