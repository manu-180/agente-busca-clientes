import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

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

  // Use limit(0) instead of head:true to avoid Vercel stripping Content-Range headers
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
    supabase
      .from('configuracion')
      .select('clave, valor')
      .in('clave', [
        'first_contact_limite_diario',
        'first_contact_hora_inicio',
        'first_contact_hora_fin',
        'first_contact_ventana_horaria_activa',
        'first_contact_intervalo_min_min',
        'first_contact_intervalo_max_min',
        'first_contact_next_slot_at',
        'first_contact_activo',
      ]),
  ])

  const cfg: Record<string, string> = {}
  for (const row of configRes.data ?? []) {
    cfg[row.clave] = row.valor
  }

  const res = NextResponse.json({
    pendientes: pendientesRes.count ?? 0,
    enviados_hoy: enviadosHoyRes.count ?? 0,
    limite_diario: parseInt(cfg.first_contact_limite_diario ?? '50', 10),
    ventana_horaria: {
      inicio: parseInt(cfg.first_contact_hora_inicio ?? '9', 10),
      fin: parseInt(cfg.first_contact_hora_fin ?? '21', 10),
    },
    ventana_horaria_activa: (cfg.first_contact_ventana_horaria_activa ?? 'false') === 'true',
    intervalo_min: {
      min: parseInt(cfg.first_contact_intervalo_min_min ?? '10', 10),
      max: parseInt(cfg.first_contact_intervalo_max_min ?? '15', 10),
    },
    next_slot_at: cfg.first_contact_next_slot_at ?? null,
    activo: (cfg.first_contact_activo ?? 'true') === 'true',
  })

  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
  return res
}
