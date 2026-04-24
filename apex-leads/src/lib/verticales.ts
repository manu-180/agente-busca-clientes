// Taxonomía de verticales para blindar la coherencia de rubro del agente.
// Cada vertical define:
//  - patterns: cómo se detecta desde el rubro/descripción del lead
//  - exclusivas: términos que SOLO pertenecen a esa vertical; si aparecen en una
//    respuesta generada para un lead de OTRA vertical, hay alucinación de rubro.
//  - permitidas: vocabulario natural a sugerirle al modelo.
//  - prohibidas: se arma dinámicamente a partir de las exclusivas del resto.

export type VerticalId =
  | 'moda'
  | 'gastronomia'
  | 'fitness'
  | 'salud'
  | 'estetica'
  | 'inmobiliaria'
  | 'educacion'
  | 'servicios_pro'
  | 'eventos'
  | 'generico'

interface VerticalDef {
  id: VerticalId
  label: string
  patterns: RegExp
  exclusivas: RegExp
  permitidas: string[]
}

const VERTICALES: VerticalDef[] = [
  {
    id: 'moda',
    label: 'moda / indumentaria / tienda de ropa',
    patterns:
      /\b(moda|boutique|indumentaria|ropa(?:\s+femenina|\s+masculina)?|vestidos?|tienda(?:\s+de)?\s+(?:ropa|mujer)|textil|lencer[ií]a|calzado|zapater[ií]a|accesorios?|mujer(?:\s+(?:moda|ropa|indumentaria))?)\b/i,
    exclusivas:
      /\b(catal[oó]go|talles?|prendas?|colecci[oó]n|look|outfit|temporada|env[ií]os?|probador|showroom)\b/i,
    permitidas: [
      'catálogo',
      'talles',
      'prendas',
      'colección',
      'look',
      'envíos',
      'showroom',
      'ecommerce',
      'fotos de producto',
    ],
  },
  {
    id: 'gastronomia',
    label: 'gastronomía / restaurant / bar / cafetería',
    patterns:
      /\b(restaurant(?:e)?|resto|bar|cafeter[ií]a|caf[eé]|parrilla|pizzer[ií]a|heladeria|panader[ií]a|cerveceria|delivery\s+de\s+comida|gastro(?:nom[ií]a)?)\b/i,
    exclusivas:
      /\b(men[uú]|carta|mesa(?:s)?|reserva(?:s)?\s+de\s+mesa|plato(?:s)?\s+del\s+d[ií]a|cocina|delivery\s+de\s+comida|mozo)\b/i,
    permitidas: [
      'menú',
      'carta',
      'reservas',
      'platos',
      'delivery',
      'pedidos online',
      'sucursales',
    ],
  },
  {
    id: 'fitness',
    label: 'gimnasio / fitness / entrenamiento',
    patterns:
      /\b(gimnasio|gym|crossfit|box(?:\s+de\s+crossfit)?|pilates|yoga|entrenamiento|fitness|studio\s+de\s+(?:pilates|yoga|spinning))\b/i,
    exclusivas:
      /\b(gym|gimnasio|crossfit|musculaci[oó]n|clases\s+grupales|socios?|membres[ií]a(?:s)?|reserva(?:s)?\s+de\s+clases?|entrenamiento\s+(?:personal|funcional)|turnos\s+de\s+clase)\b/i,
    permitidas: [
      'clases',
      'planes',
      'socios',
      'membresías',
      'reservas',
      'horarios',
      'entrenadores',
    ],
  },
  {
    id: 'salud',
    label: 'salud / consultorio / clínica',
    patterns:
      /\b(cl[ií]nica|consultorio|m[eé]dic[oa]|kinesiolog[ií]a|odontolog[ií]a|dentista|dermatolog[ií]a|psicolog[ií]a|nutrici[oó]n|fonoaudiolog[ií]a|veterinaria)\b/i,
    exclusivas:
      /\b(turnos?\s+m[eé]dicos?|historia\s+cl[ií]nica|obra\s+social|prepaga|receta|pacientes?|consulta\s+m[eé]dica)\b/i,
    permitidas: [
      'turnos',
      'pacientes',
      'especialidades',
      'obras sociales',
      'prepagas',
      'profesionales',
    ],
  },
  {
    id: 'estetica',
    label: 'estética / peluquería / barbería / spa',
    patterns:
      /\b(peluquer[ií]a|barber[ií]a|spa|est[eé]tica|u[ñn]as|manicur(?:a|ia)|pedicur(?:a|ia)|depilaci[oó]n|cosmetolog[ií]a|centro\s+de\s+belleza)\b/i,
    exclusivas:
      /\b(corte\s+de\s+pelo|manicur(?:a|ia)|pedicur(?:a|ia)|depilaci[oó]n|tratamiento\s+facial|masaje)\b/i,
    permitidas: [
      'turnos',
      'tratamientos',
      'servicios',
      'profesionales',
      'catálogo de servicios',
    ],
  },
  {
    id: 'inmobiliaria',
    label: 'inmobiliaria / propiedades',
    patterns:
      /\b(inmobiliaria|propiedades|bienes\s+ra[ií]ces|alquiler(?:es)?|ventas?\s+de\s+propiedades|real\s+estate)\b/i,
    exclusivas:
      /\b(propiedades?|departamentos?|casas?\s+en\s+(?:venta|alquiler)|fichas?\s+de\s+propiedad|tasaci[oó]n|operaci[oó]n\s+inmobiliaria)\b/i,
    permitidas: [
      'propiedades',
      'fichas',
      'fotos',
      'filtros',
      'mapa',
      'tasaciones',
      'contacto por propiedad',
    ],
  },
  {
    id: 'educacion',
    label: 'educación / cursos / instituto',
    patterns:
      /\b(instituto|academia|escuela|colegio|cursos?|capacitaci[oó]n|e-?learning|formaci[oó]n)\b/i,
    exclusivas:
      /\b(alumn[oa]s?|inscripci[oó]n(?:es)?|cursada|matr[ií]cula|clase\s+virtual|programa\s+de\s+estudio)\b/i,
    permitidas: [
      'cursos',
      'inscripciones',
      'alumnos',
      'programa',
      'campus',
      'aula virtual',
    ],
  },
  {
    id: 'servicios_pro',
    label: 'servicios profesionales / estudios',
    patterns:
      /\b(estudio\s+(?:contable|jur[ií]dico|de\s+abogados)|contador(?:es)?|abogad[oa]s?|arquitect[oa]s?|consultora|asesor[ií]a)\b/i,
    exclusivas:
      /\b(honorarios|asesor[ií]a|consultas\s+legales|balance|liquidaci[oó]n\s+de\s+sueldos|causa\s+judicial)\b/i,
    permitidas: ['servicios', 'casos', 'consultas', 'áreas de práctica', 'equipo'],
  },
  {
    id: 'eventos',
    label: 'eventos / organización / catering',
    patterns:
      /\b(eventos?|catering|salones?\s+de\s+fiesta|wedding\s+planner|organizaci[oó]n\s+de\s+eventos?|bodas?|casamientos?)\b/i,
    exclusivas:
      /\b(salones?\s+de\s+fiesta|cotizaci[oó]n\s+de\s+evento|men[uú]\s+de\s+catering|lista\s+de\s+invitados)\b/i,
    permitidas: ['eventos', 'salón', 'catering', 'cotizaciones', 'galería de eventos'],
  },
]

const VERTICAL_LABEL: Record<VerticalId, string> = VERTICALES.reduce(
  (acc, v) => {
    acc[v.id] = v.label
    return acc
  },
  { generico: 'negocio (rubro genérico)' } as Record<VerticalId, string>
)

/** Detecta la vertical dominante a partir del rubro + descripción del lead. */
export function detectarVertical(rubro: string, descripcion?: string | null): VerticalId {
  const ref = `${rubro ?? ''} ${descripcion ?? ''}`.trim()
  if (!ref) return 'generico'
  for (const v of VERTICALES) {
    if (v.patterns.test(ref)) return v.id
  }
  return 'generico'
}

export function labelVertical(id: VerticalId): string {
  return VERTICAL_LABEL[id] ?? VERTICAL_LABEL.generico
}

/** Devuelve el vocabulario natural que el modelo puede usar para este rubro. */
export function terminosPermitidos(id: VerticalId): string[] {
  const def = VERTICALES.find(v => v.id === id)
  return def?.permitidas ?? []
}

/**
 * Devuelve términos "prohibidos" para el lead actual: son los exclusivos de
 * otras verticales. Útil para listarle al modelo qué vocabulario NO usar.
 */
export function terminosProhibidos(id: VerticalId): string[] {
  const otras = VERTICALES.filter(v => v.id !== id)
  const muestras: string[] = []
  for (const v of otras) {
    // Tomamos una muestra legible por vertical (3 palabras representativas).
    switch (v.id) {
      case 'moda':
        muestras.push('talles', 'prendas', 'colección')
        break
      case 'gastronomia':
        muestras.push('menú', 'carta', 'reservas de mesa')
        break
      case 'fitness':
        muestras.push('gym', 'clases grupales', 'membresías', 'socios')
        break
      case 'salud':
        muestras.push('turnos médicos', 'pacientes', 'obra social')
        break
      case 'estetica':
        muestras.push('corte de pelo', 'manicura', 'depilación')
        break
      case 'inmobiliaria':
        muestras.push('propiedades', 'tasación', 'fichas de propiedad')
        break
      case 'educacion':
        muestras.push('alumnos', 'inscripciones', 'cursada')
        break
      case 'servicios_pro':
        muestras.push('honorarios', 'consultas legales', 'balance')
        break
      case 'eventos':
        muestras.push('salón de fiesta', 'catering', 'lista de invitados')
        break
      default:
        break
    }
  }
  return Array.from(new Set(muestras))
}

/**
 * Detecta si un texto libre (respuesta del modelo) menciona vocabulario
 * EXCLUSIVO de una vertical distinta a la del lead. Si sí, devuelve el id
 * de la vertical intrusa; si no, null.
 */
export function detectarVerticalIntrusa(
  texto: string,
  verticalLead: VerticalId
): VerticalId | null {
  if (!texto) return null
  for (const v of VERTICALES) {
    if (v.id === verticalLead) continue
    if (v.exclusivas.test(texto)) return v.id
  }
  return null
}

/**
 * Capa 1 — saneamiento de apex_info.
 * Recorre los bloques del texto (separados por línea en blanco) y descarta
 * los que mencionan vocabulario EXCLUSIVO de una vertical distinta a la del
 * lead. Evita que un ejemplo de gym "contamine" a un lead de moda.
 *
 * Devuelve el texto filtrado y el listado de verticales cuyos bloques se
 * removieron (útil para logs).
 */
export function sanitizarApexInfoPorVertical(
  apexInfo: string,
  verticalLead: VerticalId
): { texto: string; removidas: VerticalId[] } {
  if (!apexInfo || verticalLead === 'generico') {
    return { texto: apexInfo ?? '', removidas: [] }
  }
  const bloques = apexInfo.split(/\n{2,}/)
  const removidas: VerticalId[] = []
  const kept: string[] = []
  for (const bloque of bloques) {
    const intrusa = detectarVerticalIntrusa(bloque, verticalLead)
    if (intrusa) {
      removidas.push(intrusa)
      continue
    }
    kept.push(bloque)
  }
  return { texto: kept.join('\n\n'), removidas }
}

/** Renderiza el bloque de léxico permitido/prohibido para inyectar en el prompt. */
export function bloqueLexicoVertical(id: VerticalId): string {
  if (id === 'generico') {
    return [
      'LÉXICO DE RUBRO',
      '- Rubro sin definir todavía: preguntá de qué se trata antes de proponer features específicas de alguna vertical.',
      '- PROHIBIDO asumir rubro (nada de menú, talles, gym, turnos, propiedades, etc.) hasta confirmar con el cliente.',
    ].join('\n')
  }
  const permitidas = terminosPermitidos(id)
  const prohibidas = terminosProhibidos(id)
  return [
    'LÉXICO DE RUBRO (OBLIGATORIO)',
    `- Vertical confirmada del lead: ${labelVertical(id)}.`,
    permitidas.length
      ? `- Vocabulario natural para este rubro (usalo): ${permitidas.join(', ')}.`
      : '- Usá vocabulario coherente con el rubro del lead.',
    prohibidas.length
      ? `- PROHIBIDO usar vocabulario de otras verticales (ejemplos a evitar): ${prohibidas.join(', ')}.`
      : '',
    '- Si el cliente responde algo corto o ambiguo ("dale", "ok", "me encantaría"), la siguiente pregunta sigue dentro de esta vertical.',
  ]
    .filter(Boolean)
    .join('\n')
}
