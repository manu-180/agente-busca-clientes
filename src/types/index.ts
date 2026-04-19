export type EstadoLead =
  | 'pendiente'
  | 'contactado'
  | 'respondio'
  | 'interesado'
  | 'presupuesto_enviado'
  | 'cerrado'
  | 'descartado'
  | 'no_interesado'
  | 'cliente'

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
  conversacion_cerrada?: boolean
  conversacion_cerrada_at?: string | null
  mensaje_enviado?: boolean
  video_enviado?: boolean
  primer_envio_intentos?: number
  primer_envio_error?: string | null
  primer_envio_completado_at?: string | null
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
  /** true = enviado manualmente (inbox); false = agente automático / webhook */
  manual?: boolean
  /** true = mensaje de seguimiento automático (cron) */
  es_followup?: boolean
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
