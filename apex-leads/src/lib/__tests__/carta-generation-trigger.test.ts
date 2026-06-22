import { debeGenerarCartaParaLead } from '@/lib/carta-generation-trigger'

describe('debeGenerarCartaParaLead', () => {
  it('true: proyecto Carta sin pagina_url (incluye vacío / solo espacios)', () => {
    expect(debeGenerarCartaParaLead({ projectSlug: 'carta', paginaUrl: null })).toBe(true)
    expect(debeGenerarCartaParaLead({ projectSlug: 'carta', paginaUrl: undefined })).toBe(true)
    expect(debeGenerarCartaParaLead({ projectSlug: 'carta', paginaUrl: '' })).toBe(true)
    expect(debeGenerarCartaParaLead({ projectSlug: 'carta', paginaUrl: '   ' })).toBe(true)
  })

  it('false: proyecto Carta que YA tiene su carta', () => {
    expect(
      debeGenerarCartaParaLead({
        projectSlug: 'carta',
        paginaUrl: 'https://www.carta.it.com/r/lo-de-facu',
      })
    ).toBe(false)
  })

  it('false: otros proyectos (usan link fijo, no se autogenera)', () => {
    expect(debeGenerarCartaParaLead({ projectSlug: 'apex', paginaUrl: null })).toBe(false)
    expect(debeGenerarCartaParaLead({ projectSlug: 'assistify', paginaUrl: null })).toBe(false)
    expect(debeGenerarCartaParaLead({ projectSlug: null, paginaUrl: null })).toBe(false)
    expect(debeGenerarCartaParaLead({ projectSlug: undefined, paginaUrl: null })).toBe(false)
  })
})
