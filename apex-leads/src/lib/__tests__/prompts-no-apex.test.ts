import { buildAgentPrompt, type AgenteContextoLead } from '@/lib/prompts'
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

const lead: AgenteContextoLead = {
  nombre: 'Taller de Cerámica',
  rubro: 'taller de ceramica',
  zona: 'Caballito',
  descripcion: null,
  mensajeInicial: null,
}

const DESC_ASSISTIFY =
  'una app gratuita para talleres de danza, yoga, pilates, ceramica y cualquier disciplina con clases fijas. Permite que los alumnos gestionen sus cancelaciones solos.'

describe('buildAgentPrompt — proyecto gratis no-APEX (Assistify)', () => {
  const project = fakeProject({ slug: 'assistify', nombre: 'Assistify', descripcion: DESC_ASSISTIFY })
  const prompt = buildAgentPrompt('outbound', project, '[PRECIO] Costo\nGratis.', '', lead)

  it('usa la identidad del proyecto, no la de APEX', () => {
    expect(prompt).toContain('parte del equipo de Assistify')
    expect(prompt).not.toContain('agencia de desarrollo web y apps')
    expect(prompt).not.toContain('Sos Manuel, parte del equipo de APEX')
  })

  it('incluye la regla explícita de que es gratis', () => {
    expect(prompt).toContain('Assistify ES GRATIS')
    expect(prompt).toContain('completamente gratis')
  })

  it('incluye la regla de que no existe el boceto', () => {
    expect(prompt).toContain('NO EXISTE NINGÚN "BOCETO"')
  })

  it('el próximo paso es usar/descargar la app', () => {
    expect(prompt).toContain('use o descargue Assistify')
  })

  it('agrega el recordatorio final (override) para no-APEX', () => {
    expect(prompt).toContain('<recordatorio_final')
  })

  it('NO arrastra el ejemplo positivo de boceto de APEX', () => {
    // En APEX existe el ejemplo <assistant>Buenísimo. En menos de 24 horas te mando el boceto...
    // Para Assistify ese texto solo puede aparecer como <assistant_wrong> (mal ejemplo).
    expect(prompt).not.toContain(
      '<assistant>Buenísimo. En menos de 24 horas te mando el boceto'
    )
  })
})

describe('buildAgentPrompt — Assistify: foco en que el cliente PRUEBE la app', () => {
  const project = fakeProject({ slug: 'assistify', nombre: 'Assistify', descripcion: DESC_ASSISTIFY })
  const prompt = buildAgentPrompt('inbound', project, '[PRECIO] Costo\nGratis.', '', lead)

  it('declara el objetivo único: que la persona pruebe la app', () => {
    expect(prompt).toContain('<objetivo')
    expect(prompt).toContain('PRUEBE Assistify')
  })

  it('exige responder la pregunta antes de guiar (answer-first)', () => {
    expect(prompt).toContain('RESPONDÉ LA PREGUNTA PRIMERO')
    expect(prompt).toContain('responder una pregunta con otra pregunta')
  })

  it('prohíbe interrogar / sacar charla y pedir datos del negocio', () => {
    expect(prompt).toContain('NO INTERROGUES NI SAQUES CHARLA')
  })

  it('cuando es gratis, arranca por el "sí" sin hedging', () => {
    expect(prompt).toContain('arrancá por el "sí"')
    expect(prompt).toContain('Sí, 100% gratis')
  })

  it('incluye el mal ejemplo de deflección (sacar charla ante "¿es gratis?")', () => {
    expect(prompt).toContain('Contame un poco más de tu taller')
  })
})

describe('buildAgentPrompt — proyecto no-APEX sin precio gratis', () => {
  const project = fakeProject({ slug: 'handy', nombre: 'Handy', descripcion: 'una herramienta para equipos.' })
  const prompt = buildAgentPrompt('inbound', project, '[INFO] x\ny', '', lead)

  it('usa la regla de no inventar pagos (no afirma gratis)', () => {
    expect(prompt).toContain('NO INVENTES PRECIOS NI PAGOS')
    expect(prompt).not.toContain('Handy ES GRATIS')
    // Un proyecto no-gratis NUNCA debe AFIRMAR que es gratis (sí puede mencionar la
    // pregunta del cliente "¿es gratis?"). Estas frases solo existen en la rama gratis.
    expect(prompt).not.toContain('es gratis y se maneja sola')
    expect(prompt).not.toContain('es completamente gratis')
  })
})

describe('buildAgentPrompt — APEX queda intacto', () => {
  const project = fakeProject({ slug: 'apex', nombre: 'APEX', descripcion: 'Agencia web.' })
  const prompt = buildAgentPrompt('outbound', project, '[INFO] x', '', lead)

  it('mantiene la identidad e ejemplos maduros de APEX', () => {
    expect(prompt).toContain('agencia de desarrollo web y apps en Buenos Aires')
    expect(prompt).toContain('En menos de 24 horas te mando el boceto')
  })

  it('NO le inyecta el recordatorio_final ni la regla de gratis', () => {
    expect(prompt).not.toContain('<recordatorio_final')
    expect(prompt).not.toContain('ES GRATIS')
  })
})
