import {
  respuestaTrasAutomatico,
  mensajeCierreInteresado,
  mensajeHandoffHumano,
} from '@/lib/respuestas-canned'
import type { ProjectRow } from '@/lib/projects'

function fakeProject(over: Partial<ProjectRow>): ProjectRow {
  return {
    id: 'fake-id',
    slug: 'assistify',
    nombre: 'Assistify',
    descripcion: '',
    plantilla_primer_mensaje: '',
    activo: true,
    orden: 0,
    ...over,
  } as unknown as ProjectRow
}

const apex = fakeProject({ slug: 'apex', nombre: 'APEX', descripcion: 'Agencia web.' })

const assistify = fakeProject({
  slug: 'assistify',
  nombre: 'Assistify',
  descripcion: 'una app gratuita para talleres con clases fijas.',
  plantilla_primer_mensaje:
    'Hola. Desarrollamos *Assistify* gratis.\n\nDescargála acá: https://assistify.lat/download\n\n¿Lo ves útil?',
})

describe('respuestas-canned — APEX queda intacto (comportamiento calibrado)', () => {
  it('respuestaTrasAutomatico conserva el texto de APEX (theapexweb.com)', () => {
    expect(respuestaTrasAutomatico(apex)).toContain('theapexweb.com')
  })

  it('mensajeCierreInteresado de APEX deriva a un humano del equipo', () => {
    expect(mensajeCierreInteresado(apex)).toContain('Te escribe alguien del equipo')
  })

  it('mensajeHandoffHumano de APEX promete el boceto en 24h', () => {
    expect(mensajeHandoffHumano(apex)).toContain('boceto')
  })

  it('project null se trata como APEX (default histórico del programa)', () => {
    expect(respuestaTrasAutomatico(null)).toContain('theapexweb.com')
    expect(mensajeCierreInteresado(null)).toContain('Te escribe alguien del equipo')
    expect(mensajeHandoffHumano(null)).toContain('boceto')
  })
})

describe('respuestas-canned — Assistify empuja SIEMPRE a probar la app', () => {
  it('tras el auto-reply del negocio usa el link de descarga, nunca APEX/theapexweb.com', () => {
    const r = respuestaTrasAutomatico(assistify)
    expect(r).toContain('https://assistify.lat/download')
    expect(r).not.toContain('theapexweb.com')
    expect(r).not.toContain('APEX')
  })

  it('ante señal de compromiso lleva a la descarga, NO a "coordina un humano"', () => {
    const r = mensajeCierreInteresado(assistify)
    expect(r).toContain('https://assistify.lat/download')
    expect(r).not.toContain('Te escribe alguien del equipo')
    expect(r).not.toContain('coordinar')
  })

  it('ante pedido de "hablar con alguien" no menciona boceto y ofrece ayuda + descarga', () => {
    const r = mensajeHandoffHumano(assistify)
    expect(r).not.toContain('boceto')
    expect(r).not.toContain('24 horas')
    expect(r).toContain('https://assistify.lat/download')
  })

  it('dice "gratis" solo si la descripción del proyecto lo indica', () => {
    expect(mensajeCierreInteresado(assistify)).toContain('gratis')

    const pago = fakeProject({
      slug: 'handy',
      nombre: 'Handy',
      descripcion: 'una herramienta para equipos.',
      plantilla_primer_mensaje: 'Probala acá: https://handy.example/get',
    })
    const r = mensajeCierreInteresado(pago)
    expect(r).toContain('https://handy.example/get')
    expect(r).not.toContain('gratis')
  })
})

describe('respuestas-canned — parámetro downloadLink (anti-ban Fase 2)', () => {
  const sinLinkEnTemplate = fakeProject({
    slug: 'assistify',
    nombre: 'Assistify',
    descripcion: 'una app gratuita para talleres con clases fijas.',
    plantilla_primer_mensaje: 'Hola {{nombre}}. ¿Lo ves útil para tu taller?',
  })
  const linkProjectInfo = 'https://assistify.lat/download'

  it('downloadLink explícito se usa aunque la plantilla no tenga link', () => {
    expect(mensajeCierreInteresado(sinLinkEnTemplate, linkProjectInfo)).toContain(linkProjectInfo)
    expect(respuestaTrasAutomatico(sinLinkEnTemplate, linkProjectInfo)).toContain(linkProjectInfo)
    expect(mensajeHandoffHumano(sinLinkEnTemplate, linkProjectInfo)).toContain(linkProjectInfo)
  })

  it('sin downloadLink y sin link en plantilla usa el fallback sin-link (texto limpio)', () => {
    const r = mensajeCierreInteresado(sinLinkEnTemplate)
    expect(r).not.toContain('http')
    expect(r).not.toContain('arriba')
  })

  it('downloadLink=null cae al link de la plantilla como antes (backward compat)', () => {
    expect(mensajeCierreInteresado(assistify, null)).toContain('https://assistify.lat/download')
  })

  it('APEX ignora downloadLink aunque se pase', () => {
    const r = mensajeCierreInteresado(apex, linkProjectInfo)
    expect(r).toContain('Te escribe alguien del equipo')
    expect(r).not.toContain(linkProjectInfo)
  })
})
