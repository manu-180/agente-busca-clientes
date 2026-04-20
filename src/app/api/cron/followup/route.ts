import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { ejecutarConTablaLeads } from '@/lib/leads-table'
import { enviarMensajeWassenger } from '@/lib/wassenger'
import { evaluarFollowup } from '@/lib/followup-eligibility'
import { generarMensajeFollowupClaude } from '@/lib/generar-followup'
import type { Lead } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const ESTADOS_EXCLUIDOS = new Set(['no_interesado', 'cliente'])

function authCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = req.headers.get('authorization')
  return auth === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createSupabaseServer()

  const { data: cfg } = await supabase.from('configuracion').select('valor').eq('clave', 'agente_activo').single()
  if (cfg?.valor !== 'true') {
    return NextResponse.json({ ok: true, skipped: true, motivo: 'agente_global_off' })
  }

  const { data: leadsRaw, error: errLeads } = await ejecutarConTablaLeads<Lead[]>((tabla) =>
    supabase.from(tabla).select('*').eq('agente_activo', true)
  )

  if (errLeads || !leadsRaw) {
    return NextResponse.json(
      { error: errLeads?.message ?? 'No se pudieron cargar leads' },
      { status: 500 }
    )
  }

  const leads = leadsRaw.filter(l => !ESTADOS_EXCLUIDOS.has(l.estado) && !l.conversacion_cerrada)
  const resultados: Array<{ lead_id: string; ok: boolean; detalle?: string }> = []

  for (const lead of leads) {
    const { count: nFollowups, error: errCount } = await supabase
      .from('conversaciones')
      .select('*', { count: 'exact', head: true })
      .eq('lead_id', lead.id)
      .eq('es_followup', true)

    if (errCount) {
      resultados.push({ lead_id: lead.id, ok: false, detalle: errCount.message })
      continue
    }

    const followupsEnviados = nFollowups ?? 0

    const { data: mensajes, error: errMsg } = await supabase
      .from('conversaciones')
      .select('timestamp, rol, es_followup, mensaje')
      .eq('lead_id', lead.id)
      .order('timestamp', { ascending: true })

    if (errMsg || !mensajes) {
      resultados.push({ lead_id: lead.id, ok: false, detalle: errMsg?.message })
      continue
    }

    const evaluacion = evaluarFollowup({
      mensajes: mensajes.map(m => ({
        timestamp: m.timestamp,
        rol: m.rol as 'agente' | 'cliente',
        es_followup: m.es_followup,
      })),
      followupsEnviados,
      conversacionCerrada: !!lead.conversacion_cerrada,
    })

    if (!evaluacion.elegible) {
      resultados.push({ lead_id: lead.id, ok: true, detalle: `skip:${evaluacion.motivo}` })
      continue
    }

    const historialBreve = mensajes
      .slice(-8)
      .map(m => `[${m.rol === 'agente' ? 'APEX' : 'CLIENTE'}] ${m.mensaje}`)
      .join('\n')

    const clienteRespondioAlguna = mensajes.some(m => m.rol === 'cliente')
    const texto = await generarMensajeFollowupClaude(lead, historialBreve, {
      followupsPrevios: followupsEnviados,
      clienteRespondioAlguna,
      mensajeInicialApex: lead.mensaje_inicial ?? null,
    })
    if (!texto) {
      resultados.push({ lead_id: lead.id, ok: false, detalle: 'claude_null' })
      continue
    }

    try {
      await enviarMensajeWassenger(lead.telefono, texto)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      resultados.push({ lead_id: lead.id, ok: false, detalle: `wassenger:${msg}` })
      continue
    }

    const { error: errIns } = await supabase.from('conversaciones').insert({
      lead_id: lead.id,
      telefono: lead.telefono,
      mensaje: texto,
      rol: 'agente',
      tipo_mensaje: 'texto',
      manual: false,
      es_followup: true,
    })

    if (errIns) {
      resultados.push({ lead_id: lead.id, ok: false, detalle: `db:${errIns.message}` })
      continue
    }

    resultados.push({ lead_id: lead.id, ok: true, detalle: 'enviado' })
  }

  const enviados = resultados.filter(r => r.detalle === 'enviado').length
  return NextResponse.json({
    ok: true,
    procesados: leads.length,
    enviados,
    resultados,
  })
}
