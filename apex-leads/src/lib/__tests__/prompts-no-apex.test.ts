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

describe('buildAgentPrompt — manejo de mensajes automáticos/predefinidos del contacto', () => {
  const assistify = fakeProject({ slug: 'assistify', nombre: 'Assistify', descripcion: DESC_ASSISTIFY })
  const apex = fakeProject({ slug: 'apex', nombre: 'APEX', descripcion: 'Agencia web.' })

  it('el prompt genérico trae la regla y el ítem del checklist', () => {
    const prompt = buildAgentPrompt('outbound', assistify, '[INFO] x', '', lead)
    expect(prompt).toContain('MENSAJE AUTOMÁTICO / PREDEFINIDO DEL CONTACTO')
    // El caso real (iglesia) aparece como mal ejemplo a NO imitar.
    expect(prompt).toContain('te equivoqué de contacto')
    expect(prompt).toContain('Modo de contratación')
  })

  it('el prompt de APEX también trae la regla y los casos reales', () => {
    const prompt = buildAgentPrompt('outbound', apex, '[INFO] x', '', lead)
    expect(prompt).toContain('MENSAJE AUTOMÁTICO / PREDEFINIDO DEL CONTACTO')
    expect(prompt).toContain('te equivoqué de contacto')
    expect(prompt).toContain('Modo de contratación')
  })
})

describe('buildAgentPrompt — Instagram / página web → www.theapexweb.com en TODOS los proyectos', () => {
  const apex = fakeProject({ slug: 'apex', nombre: 'APEX', descripcion: 'Agencia web.' })
  const assistify = fakeProject({ slug: 'assistify', nombre: 'Assistify', descripcion: DESC_ASSISTIFY })
  const handy = fakeProject({ slug: 'handy', nombre: 'Handy', descripcion: 'una herramienta para equipos.' })

  for (const project of [apex, assistify, handy]) {
    it(`${project.nombre}: inyecta la regla de Instagram/web con el hub público`, () => {
      const prompt = buildAgentPrompt('inbound', project, '[INFO] x', '', lead)
      expect(prompt).toContain('INSTAGRAM / PÁGINA WEB / TRABAJOS')
      expect(prompt).toContain('www.theapexweb.com')
    })
  }

  it('en self-serve, theapexweb.com aparece como excepción explícita (no como prohibición total)', () => {
    const prompt = buildAgentPrompt('inbound', assistify, '[INFO] x', '', lead)
    expect(prompt).toContain('ÚNICA excepción: si te piden tu Instagram')
  })

  it('self-serve con URL en project_info incluye DOS links: el del proyecto y theapexweb.com', () => {
    const prompt = buildAgentPrompt(
      'inbound',
      assistify,
      '[INFO] Descargá Assistify gratis: https://assistify.lat/download',
      '',
      lead,
    )
    expect(prompt).toContain('assistify.lat/download')
    expect(prompt).toContain('www.theapexweb.com')
    expect(prompt).toContain('DOS links')
  })

  it('self-serve con URL en plantilla (sin URL en project_info) incluye ambos links', () => {
    const conPlantilla = fakeProject({
      slug: 'assistify',
      nombre: 'Assistify',
      descripcion: DESC_ASSISTIFY,
      plantilla_primer_mensaje: 'Hola! Probá Assistify gratis: https://assistify.lat/download',
    })
    const prompt = buildAgentPrompt('inbound', conPlantilla, '[INFO] info sin url', '', lead)
    expect(prompt).toContain('assistify.lat/download')
    expect(prompt).toContain('www.theapexweb.com')
    expect(prompt).toContain('DOS links')
  })

  it('self-serve sin URL en ningún lado → solo theapexweb.com (sin "DOS links")', () => {
    const prompt = buildAgentPrompt('inbound', assistify, '[INFO] sin url', '', lead)
    expect(prompt).toContain('www.theapexweb.com')
    expect(prompt).not.toContain('DOS links')
  })

  it('APEX con URL en projectInfo NO incluye la URL (regla fija, hub solo)', () => {
    const prompt = buildAgentPrompt(
      'inbound',
      apex,
      '[INFO] Descargá algo: https://otro.com/link',
      '',
      lead,
    )
    // APEX siempre usa solo theapexweb.com, nunca extrae URLs de project_info
    expect(prompt).not.toContain('DOS links')
    expect(prompt).toContain('www.theapexweb.com')
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

describe('buildAgentPrompt — disciplina de links (Carta: usar el [BOCETO], nunca inventar URLs)', () => {
  const carta = fakeProject({
    slug: 'carta',
    nombre: 'Carta',
    descripcion: 'Carta digital con QR para restaurantes — el cliente escanea, elige y pide desde su cel.',
  })
  const projectInfoSinLink = '[SERVICIOS] Que es Carta\nUna carta digital con QR para restaurantes.'

  it('inyecta la REGLA 11: nunca inventar URLs, solo las del contexto', () => {
    const prompt = buildAgentPrompt('inbound', carta, projectInfoSinLink, '', lead)
    expect(prompt).toContain('LINKS: SOLO LOS DEL CONTEXTO, NUNCA INVENTADOS')
    expect(prompt).toContain('NUNCA inventes')
    // La regla nombra explícitamente el host prohibido y el placeholder.
    expect(prompt).toContain('.vercel.app')
    expect(prompt).toContain('[BOCETO]')
  })

  it('el prompt NUNCA contiene el placeholder viejo carta.vercel.app', () => {
    const prompt = buildAgentPrompt('inbound', carta, projectInfoSinLink, '', lead)
    expect(prompt).not.toContain('carta.vercel.app')
  })

  it('sin link en el contexto, no hay ninguna URL que el agente pueda copiar', () => {
    const prompt = buildAgentPrompt('inbound', carta, projectInfoSinLink, '', lead)
    // Salvo el hub fijo de Instagram/web, no debe haber otra URL "compartible".
    expect(prompt).not.toContain('https://www.carta.it.com/r/')
  })

  it('con un bloque [BOCETO] en el contexto, comparte EXACTO ese link (la página real del lead)', () => {
    const projectInfoConBoceto =
      '[SERVICIOS] Que es Carta\nUna carta digital.\n\n' +
      '[BOCETO] Ya hay una página/demo REAL hecha para ESTE negocio: https://www.carta.it.com/r/lo-de-facu\n' +
      'Compartís EXACTAMENTE este link y NINGÚN otro.'
    const prompt = buildAgentPrompt('inbound', carta, projectInfoConBoceto, '', lead)
    expect(prompt).toContain('https://www.carta.it.com/r/lo-de-facu')
    // REGLA 11 / objection exigen mandarlo EXACTO.
    expect(prompt).toContain('EXACTO')
  })

  it('la objeción "¿me mostrás alguno?" enruta al link [BOCETO], no a inventar', () => {
    const prompt = buildAgentPrompt('inbound', carta, projectInfoSinLink, '', lead)
    expect(prompt).toContain('¿Me mostrás alguno?')
  })
})
