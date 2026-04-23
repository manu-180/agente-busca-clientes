import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

const LEADS_TABLE = 'leads'
const TZ_OFFSET_HOURS_AR = -3
/** Inicio/fin de la “ventana” solo para mostrar en UI: 24 h (sin límite en el cron). */
const HORA_INICIO_AR = 0
const HORA_FIN_AR = 23

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

  const [pendientesRes, enviadosHoyRes, configRes] = await Promise.all([
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
    supabase.from('configuracion').select('valor').eq('clave', 'first_contact_activo').maybeSingle(),
  ])

  const activo = (configRes.data?.valor ?? 'true') === 'true'

  const res = NextResponse.json({
    pendientes: pendientesRes.count ?? 0,
    enviados_hoy: enviadosHoyRes.count ?? 0,
    ventana_horaria: {
      inicio: HORA_INICIO_AR,
      fin: HORA_FIN_AR,
    },
    activo,
  })

  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
  return res
}
