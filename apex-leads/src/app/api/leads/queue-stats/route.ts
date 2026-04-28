import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import {
  estaEnVentanaPrimerContacto,
  PRIMER_CONTACTO_HORA_FIN_AR,
  PRIMER_CONTACTO_HORA_INICIO_AR,
} from '@/lib/first-contact-window'

export const dynamic = 'force-dynamic'

const LEADS_TABLE = 'leads'
const TZ_OFFSET_HOURS_AR = -3

function inicioDelDiaArUtc(): Date {
  const ahoraUtcMs = Date.now()
  const offsetMs = TZ_OFFSET_HOURS_AR * 60 * 60 * 1000
  const ahoraArMs = ahoraUtcMs + offsetMs
  const diaArMs = Math.floor(ahoraArMs / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000)
  return new Date(diaArMs - offsetMs)
}

export async function GET() {
  const supabase = createSupabaseServer()

  const inicioDiaUtc = inicioDelDiaArUtc().toISOString()

  const [pendientesRes, enviadosHoyRes, fallidosHoyRes, configRes] = await Promise.all([
    supabase
      .from(LEADS_TABLE)
      .select('id', { count: 'exact' })
      .eq('origen', 'outbound')
      .eq('mensaje_enviado', false)
      .eq('estado', 'pendiente')
      .limit(0),
    supabase
      .from(LEADS_TABLE)
      .select('id', { count: 'exact' })
      .gte('primer_envio_completado_at', inicioDiaUtc)
      .limit(0),
    supabase
      .from(LEADS_TABLE)
      .select('id', { count: 'exact' })
      .gte('primer_envio_fallido_at', inicioDiaUtc)
      .limit(0),
    supabase.from('configuracion').select('valor').eq('clave', 'first_contact_activo').maybeSingle(),
  ])

  const activo = (configRes.data?.valor ?? 'true') === 'true'

  const ahora = new Date()
  const res = NextResponse.json({
    pendientes: pendientesRes.count ?? 0,
    enviados_hoy: enviadosHoyRes.count ?? 0,
    fallidos_hoy: fallidosHoyRes.count ?? 0,
    ventana_horaria: {
      inicio: PRIMER_CONTACTO_HORA_INICIO_AR,
      fin: PRIMER_CONTACTO_HORA_FIN_AR,
    },
    en_ventana: estaEnVentanaPrimerContacto(ahora),
    activo,
  })

  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
  return res
}
