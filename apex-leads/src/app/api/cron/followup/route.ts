import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { ejecutarConTablaLeads } from '@/lib/leads-table'
import { enviarMensajeEvolution, EVO_ERR, isEvolutionError } from '@/lib/evolution'
import { selectNextSender } from '@/lib/sender-pool'
import { evaluarFollowup } from '@/lib/followup-eligibility'
import { generarMensajeFollowupClaude } from '@/lib/generar-followup'
import { cargarProyectoPorId } from '@/lib/projects'
import { claveUnicaPaisLinea } from '@/lib/phone'
import { isTelefonoHardBlocked } from '@/lib/phone-blocklist'
import {
  estaEnVentanaPrimerContacto,
  getHoraArgentina,
  PRIMER_CONTACTO_HORA_INICIO_AR,
  PRIMER_CONTACTO_HORA_FIN_AR,
} from '@/lib/first-contact-window'
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

  if (!estaEnVentanaPrimerContacto()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      motivo: 'fuera_de_ventana',
      hora_argentina: getHoraArgentina(),
      ventana: { inicio: PRIMER_CONTACTO_HORA_INICIO_AR, fin: PRIMER_CONTACTO_HORA_FIN_AR },
    })
  }

  // Proyección explícita (no select('*')) para reducir egress: solo las columnas
  // que se leen de cada lead aguas abajo en este loop.
  //   id                   -> count/historial/insert/return en todo el loop
  //   telefono             -> dedup (claveUnicaPaisLinea) + isTelefonoHardBlocked + insert/envío
  //   nombre/rubro/zona    -> generarMensajeFollowupClaude userContent (lib/generar-followup)
  //   origen               -> dedup sort + userContent
  //   estado               -> ESTADOS_EXCLUIDOS.has(l.estado)
  //   mensaje_enviado      -> dedup sort (preferencia)
  //   mensaje_inicial      -> stage.mensajeInicialApex (coherencia de oferta)
  //   created_at           -> dedup sort (desempate por antigüedad)
  //   project_id           -> cargarProyectoPorId
  //   conversacion_cerrada -> filtro + evaluarFollowup
  // agente_activo se filtra server-side (.eq) y no se lee de la fila.
  const COLS_LEAD_FOLLOWUP =
    'id, telefono, nombre, rubro, zona, estado, origen, mensaje_enviado, mensaje_inicial, created_at, project_id, conversacion_cerrada'
  const { data: leadsRaw, error: errLeads } = await ejecutarConTablaLeads<Lead[]>((tabla) =>
    // .returns<Lead[]>(): la proyección angosta no infiere `Lead[]`; el loop solo
    // lee columnas presentes en COLS_LEAD_FOLLOWUP, así que afirmamos el tipo.
    supabase.from(tabla).select(COLS_LEAD_FOLLOWUP).eq('agente_activo', true).eq('mensaje_enviado', true).neq('estado', 'pendiente').limit(15).returns<Lead[]>()
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

    // Egress: antes esto traía TODO el historial (incl. texto completo de cada
    // `mensaje`) sin límite, por lead, por tick. Solo se necesitan los últimos 8
    // mensajes (historialBreve = slice(-8)); evaluarFollowup inspecciona la cola
    // de la conversación (último msg, último cliente, último followup), todos
    // dentro de esa ventana. Traemos descendente con limit(8) y revertimos a
    // ascendente en JS para preservar el orden que esperan los consumidores.
    const { data: mensajesDesc, error: errMsg } = await supabase
      .from('conversaciones')
      .select('timestamp, rol, es_followup, mensaje')
      .eq('lead_id', lead.id)
      .order('timestamp', { ascending: false })
      .limit(8)

    if (errMsg || !mensajesDesc) {
      resultados.push({ lead_id: lead.id, ok: false, detalle: errMsg?.message })
      continue
    }

    // Orden ascendente (más viejo → más nuevo), igual que el select original.
    const mensajes = [...mensajesDesc].reverse()

    // El conteo autoritativo de followups ya viene del query count:'exact' de
    // arriba (cuenta TODOS los followups del lead en DB, no la ventana). Antes
    // se recontaba sobre el historial completo y se hacía Math.max — ahora ese
    // recuento es redundante (y un full-scan); usamos el count directamente.
    const followupsEfectivos = followupsEnviados

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
    if (!lead.project_id) {
      resultados.push({ lead_id: lead.id, ok: false, detalle: 'lead_sin_project_id' })
      continue
    }
    const projectLead = await cargarProyectoPorId(supabase, lead.project_id)
    if (!projectLead) {
      resultados.push({ lead_id: lead.id, ok: false, detalle: 'project_not_found' })
      continue
    }
    const texto = await generarMensajeFollowupClaude(lead, historialBreve, projectLead, {
      followupsPrevios: followupsEfectivos,
      clienteRespondioAlguna,
      mensajeInicialApex: lead.mensaje_inicial ?? null,
    })
    if (!texto) {
      resultados.push({ lead_id: lead.id, ok: false, detalle: 'claude_null' })
      continue
    }

    // Buscar sender original del lead para mantener la misma instancia
    // (continuidad de la conversación: que el cliente vea siempre el mismo número).
    const { data: ultimaConv } = await supabase
      .from('conversaciones')
      .select('sender_id')
      .eq('lead_id', lead.id)
      .not('sender_id', 'is', null)
      .order('timestamp', { ascending: false })
      .limit(1)
      .maybeSingle()

    let instanceName: string | undefined
    let senderId: string | null = ultimaConv?.sender_id ?? null
    let senderEstabaConectado = false
    if (senderId) {
      const { data: senderRow } = await supabase
        .from('senders')
        .select('instance_name, connected, activo')
        .eq('id', senderId)
        .maybeSingle()
      if (senderRow?.activo && senderRow?.connected) {
        instanceName = senderRow.instance_name ?? undefined
        senderEstabaConectado = true
      }
    }

    // Fallback: si el sender original está disconnected o inactivo, usamos
    // selectNextSender del pool para no bloquear followups eternamente.
    // Perdemos continuidad de número pero ganamos disponibilidad — preferible
    // a no enviar nada (que es lo que pasaba antes y dejaba leads colgados).
    if (!senderEstabaConectado) {
      const fallback = await selectNextSender(supabase)
      if (fallback) {
        instanceName = fallback.instance_name
        senderId = fallback.id
        console.log(
          `[followup] sender original disconnected/inactive, fallback a ${fallback.alias ?? fallback.instance_name} para lead ${lead.id}`
        )
      }
    }

    if (!instanceName) {
      resultados.push({ lead_id: lead.id, ok: false, detalle: 'sin_sender_disponible' })
      continue
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
      await enviarMensajeEvolution(lead.telefono, texto, instanceName)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      const code = isEvolutionError(e) ? e.code : null
      await supabase.from('conversaciones').delete().eq('id', convInsertada.id)

      // Si el sender que usamos no estaba conectado (no debería pasar después
      // del check arriba pero por preflight race), intentamos UNA VEZ con
      // fallback del pool — selectNextSender excluye disconnected y nos da
      // otro sano si existe.
      if (code === EVO_ERR.INSTANCE_NOT_CONNECTED) {
        const fallback = await selectNextSender(supabase, { excludeIds: senderId ? [senderId] : [] })
        if (fallback) {
          try {
            const { data: convRetry } = await supabase
              .from('conversaciones')
              .insert({
                lead_id: lead.id,
                telefono: lead.telefono,
                mensaje: texto,
                rol: 'agente',
                tipo_mensaje: 'texto',
                manual: false,
                es_followup: true,
                sender_id: fallback.id,
              })
              .select('id')
              .maybeSingle()
            await enviarMensajeEvolution(lead.telefono, texto, fallback.instance_name)
            resultados.push({ lead_id: lead.id, ok: true, detalle: `enviado_fallback:${fallback.alias ?? fallback.instance_name}` })
            continue
          } catch (e2: unknown) {
            const msg2 = e2 instanceof Error ? e2.message : String(e2)
            resultados.push({ lead_id: lead.id, ok: false, detalle: `evolution_fallback:${msg2}` })
            continue
          }
        }
      }

      resultados.push({ lead_id: lead.id, ok: false, detalle: `evolution:${msg}` })
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
