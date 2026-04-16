export interface Localidad {
  nombre: string
}

export interface Provincia {
  nombre: string
  localidades: Localidad[]
}

export interface Pais {
  codigo: string
  nombre: string
  provincias: Provincia[]
}

// Por ahora solo Argentina. Se puede extender con más países hispanohablantes.
export const PAISES_HISPANOHABLANTES: Pais[] = [
  {
    codigo: 'AR',
    nombre: 'Argentina',
    provincias: [
      {
        nombre: 'Buenos Aires',
        localidades: [
          { nombre: 'Ciudad Autónoma de Buenos Aires' },
          { nombre: 'La Plata' },
          { nombre: 'Mar del Plata' },
          { nombre: 'Bahía Blanca' },
          { nombre: 'Quilmes' },
          { nombre: 'Lanús' },
          { nombre: 'Lomas de Zamora' },
          { nombre: 'Avellaneda' },
          { nombre: 'San Isidro' },
          { nombre: 'Vicente López' },
          { nombre: 'Morón' },
          { nombre: 'Tres de Febrero' },
          { nombre: 'San Martín' },
          { nombre: 'Tigre' },
          { nombre: 'San Fernando' },
          { nombre: 'Pilar' },
          { nombre: 'Escobar' },
          { nombre: 'Ituzaingó' },
          { nombre: 'Hurlingham' },
          { nombre: 'Florencio Varela' },
        ],
      },
      {
        nombre: 'Córdoba',
        localidades: [
          { nombre: 'Córdoba Capital' },
          { nombre: 'Villa Carlos Paz' },
          { nombre: 'Río Cuarto' },
          { nombre: 'Villa María' },
        ],
      },
      {
        nombre: 'Santa Fe',
        localidades: [
          { nombre: 'Rosario' },
          { nombre: 'Santa Fe Capital' },
          { nombre: 'Rafaela' },
        ],
      },
      {
        nombre: 'Mendoza',
        localidades: [
          { nombre: 'Mendoza Capital' },
          { nombre: 'Godoy Cruz' },
          { nombre: 'Guaymallén' },
        ],
      },
    ],
  },
]

export function getDefaultPais(): Pais {
  return PAISES_HISPANOHABLANTES[0]
}

