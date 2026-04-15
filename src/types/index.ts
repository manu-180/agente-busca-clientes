export type EstadoLead =
  | 'pendiente'
  | 'contactado'
  | 'respondio'
  | 'interesado'
  | 'cerrado'
  | 'descartado'
  | 'no_interesado'

export type OrigenLead = 'outbound' | 'inbound'

export interface Lead {
  id: string
  nombre: string
  rubro: string
  zona: string
  telefono: string
  instagram: string | null
  descripcion: string
  mensaje_inicial: string
  estado: EstadoLead
  origen: OrigenLead
  agente_activo: boolean
  created_at: string
  updated_at: string
  notas: string | null
}

export interface Conversacion {
  id: string
  lead_id: string
  telefono: string
  mensaje: string
  rol: 'agente' | 'cliente'
  tipo_mensaje: 'texto' | 'audio' | 'imagen' | 'otro'
  timestamp: string
  leido: boolean
}

export interface ApexInfo {
  id: string
  categoria: string
  titulo: string
  contenido: string
  activo: boolean
  created_at: string
}

export interface Configuracion {
  id: string
  clave: string
  valor: string
}

export interface LeadGenerado {
  nombre: string
  rubro: string
  zona: string
  telefono: string
  instagram: string | null
  descripcion: string
  mensaje_sugerido: string
}

export interface ResultadoBusquedaLead {
  nombre: string
  direccion: string
  telefono: string
  rating: number
  cantidad_reviews: number
  tiene_web: boolean
  url_web: string | null
  google_maps_url: string
  ya_registrado: boolean
  rubro: string
}

export interface ConversacionResumen {
  lead: Lead
  ultimo_mensaje: string
  ultimo_timestamp: string
  no_leidos: number
}
