import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { ejecutarConTablaLeads } from '@/lib/leads-table'
import { enviarMensajeTwilio } from '@/lib/twilio'
import { evaluarFollowup } from '@/lib/followup-eligibility'
import { generarMensajeFollowupClaude } from '@/lib/generar-followup'
import { claveUnicaPaisLinea } from '@/lib/phone'
import { isTelefonoHardBlocked } from '@/lib/phone-blocklist'
import type { Lead } from '@/types'

/** Evita 2+ filas de leads (5411 / 54911) y el followup a la misma persona dos veces por tick. */
function dedupearLeadsMismaLinea(leads: Lead[]): Lead[] {
  const map = new Map<string, Lead>()
  for (const l of leads) {
    const k = claveUnicaPaisLinea(l.telefono)
    const o = map.get(k)
    if (!o) {
      map.set(k, l)
      continue
    }
    const [preferido] = [o, l].sort((a, b) => {
      if (a.mensaje_enviado && !b.mensaje_enviado) return -1
      if (!a.mensaje_enviado && b.mensaje_enviado) return 1
      if (a.origen === 'outbound' && b.origen !== 'outbound') return -1
      if (a.origen !== 'outbound' && b.origen === 'outbound') return 1
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    })
    map.set(k, preferido)
  }
  return Array.from(map.values())
}

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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

  // Bloquea ejecuciones concurrentes: solo una instancia corre a la vez.
  // Si otra instancia adquirió el lock en los últimos 10 min, retorna inmediatamente.
  const { data: lockAcquired, error: lockErr } = await supabase.rpc('try_followup_cron_lock')
  if (lockErr || !lockAcquired) {
    return NextResponse.json({ ok: true, skipped: true, motivo: 'lock_activo' })
  }

  try {
    return await runFollowup(supabase)
  } finally {
    await supabase.rpc('release_followup_cron_lock')
  }
}

async function runFollowup(supabase: ReturnType<typeof createSupabaseServer>) {
  const { data: cfg } = await supabase.from('configuracion').select('valor').eq('clave', 'agente_activo').single()
  if (cfg?.valor !== 'true') {
    return NextResponse.json({ ok: true, skipped: true, motivo: 'agente_global_off' })
  }

  const { data: leadsRaw, error: errLeads } = await ejecutarConTablaLeads<Lead[]>((tabla) =>
    supabase.from(tabla).select('*').eq('agente_activo', true).eq('mensaje_enviado', true).neq('estado', 'pendiente').limit(15)
  )

  if (errLeads || !leadsRaw) {
    return NextResponse.json(
      { error: errLeads?.message ?? 'No se pudieron cargar leads' },
      { status: 500 }
    )
  }

  const leads = dedupearLeadsMismaLinea(
    leadsRaw.filter(l => !ESTADOS_EXCLUIDOS.has(l.estado) && !l.conversacion_cerrada)
  )
  const resultados: Array<{ lead_id: string; ok: boolean; detalle?: string }> = []

  for (const lead of leads) {
    if (isTelefonoHardBlocked(lead.telefono)) {
      resultados.push({ lead_id: lead.id, ok: true, detalle: 'skip:telefono_bloqueado' })
      continue
    }

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

    const followupsEnHistorial = mensajes.filter(m => m.es_followup === true).length
    const followupsEfectivos = Math.max(followupsEnviados, followupsEnHistorial)

    const evaluacion = evaluarFollowup({
      mensajes: mensajes.map(m => ({
        timestamp: m.timestamp,
        rol: m.rol as 'agente' | 'cliente',
        es_followup: m.es_followup,
      })),
      followupsEnviados: followupsEfectivos,
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
      followupsPrevios: followupsEfectivos,
      clienteRespondioAlguna,
      mensajeInicialApex: lead.mensaje_inicial ?? null,
    })
    if (!texto) {
      resultados.push({ lead_id: lead.id, ok: false, detalle: 'claude_null' })
      continue
    }

    // Buscar sender original del lead para mantener el mismo número
    const { data: ultimaConv } = await supabase
      .from('conversaciones')
      .select('sender_id')
      .eq('lead_id', lead.id)
      .not('sender_id', 'is', null)
      .order('timestamp', { ascending: false })
      .limit(1)
      .maybeSingle()

    let senderPhone: string | undefined
    let senderId: string | null = ultimaConv?.sender_id ?? null
    if (senderId) {
      const { data: senderRow } = await supabase
        .from('senders')
        .select('phone_number')
        .eq('id', senderId)
        .maybeSingle()
      senderPhone = senderRow?.phone_number ?? undefined
    }

    const { data: convInsertada, error: errIns } = await supabase
      .from('conversaciones')
      .insert({
        lead_id: lead.id,
        telefono: lead.telefono,
        mensaje: texto,
        rol: 'agente',
        tipo_mensaje: 'texto',
        manual: false,
        es_followup: true,
        sender_id: senderId,
      })
      .select('id')
      .maybeSingle()

    if (errIns || !convInsertada) {
      resultados.push({ lead_id: lead.id, ok: false, detalle: `db:${errIns?.message ?? 'sin fila'}` })
      continue
    }

    try {
      await enviarMensajeTwilio(lead.telefono, texto, senderPhone)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      await supabase.from('conversaciones').delete().eq('id', convInsertada.id)
      resultados.push({ lead_id: lead.id, ok: false, detalle: `twilio:${msg}` })
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
