import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { variantesTelefonoMismaLinea } from '@/lib/phone'
import { isTelefonoHardBlocked } from '@/lib/phone-blocklist'
import { verificarNumeroWhatsApp } from '@/lib/phone-verify'
import {
  estaEnVentanaPrimerContacto,
  getHoraArgentina,
  PRIMER_CONTACTO_HORA_FIN_AR,
  PRIMER_CONTACTO_HORA_INICIO_AR,
} from '@/lib/first-contact-window'
import {
  extraerRatingParaPlantilla,
  resolveWhatsAppDemoHost,
  SITIO_PRINCIPAL_APEX,
} from '@/lib/whatsapp-template-demos'
import { enviarMensajeEvolution, EVO_ERR, isEvolutionError } from '@/lib/evolution'
import { fetchAllInstances } from '@/lib/evolution-instance'
import {
  selectNextSender,
  incrementMsgsToday,
  resetDailyCountersIfNeeded,
  markDisconnected,
  incrementSendFailures,
  resetSendFailures,
  updateHealthCheck,
  type PoolSender,
} from '@/lib/sender-pool'

// Inline health-check piggybacking: cada N min ejecutamos un health-check
// dentro de este cron para no depender exclusivamente del cron Vercel de
// `/api/cron/health-evolution`. En plan Hobby Vercel no permite */N min,
// y este cron de leads-pendientes ya corre con alta frecuencia.
const INLINE_HEALTH_THROTTLE_MS = 3 * 60_000

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const LEADS_TABLE = 'leads'
const MAX_REINTENTOS_LEAD = 3
const MAX_REINTENTOS_POOL = 3
// Umbral de fallos consecutivos antes de marcar sender disconnected.
// Pre-blindaje era 10 (mensajes al vacío). Ahora con preflight + connection.update,
// la señal de "sesión rota" llega por otros canales (preflight close, webhook
// connection.update) antes de que el contador sume.
// Subido a 8 (era 3) porque 3 fallos consecutivos suceden trivialmente con un
// blip de 30-60s del servidor Evolution (Railway) y mata senders sanos. El
// 2026-05-20 un episodio de "Evolution 500 Connection Closed" de 15 min cayó
// los 4 senders activos al mismo tiempo.
const MAX_FALLOS_CONSECUTIVOS = 8
// Ventana para detectar "server-wide outage" (no solo un sender específico):
// si varios senders distintos fallaron con error temporal en los últimos N min,
// asumimos que el problema es de Evolution server y NO marcamos disconnected
// — esperamos a que Evolution se recupere en vez de tirar abajo todo el pool.
const OUTAGE_WINDOW_MS = 5 * 60_000
const OUTAGE_MIN_OTHER_SENDERS = 1

type SupabaseClient = ReturnType<typeof createSupabaseServer>

interface LeadColaRow {
  id: string
  nombre: string
  rubro: string
  zona: string
  telefono: string
  instagram: string | null
  descripcion: string
  mensaje_inicial: string
  estado: string
  origen: string
  mensaje_enviado: boolean
  video_enviado: boolean
  primer_envio_intentos: number
  primer_envio_error: string | null
  primer_envio_completado_at: string | null
}

function authCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

function construirMensajePrimerContacto(lead: LeadColaRow): string {
  const rating = extraerRatingParaPlantilla(lead.descripcion)
  const demoHost = resolveWhatsAppDemoHost(lead.rubro, lead.descripcion)
  return [
    `Hola ${lead.nombre}`,
    `Vi que tu negocio tiene ${rating}⭐ en Google Maps.`,
    `Hice este boceto para un negocio como el tuyo: ${demoHost}`,
    `Trabajo con negocios de ${lead.zona} haciendo páginas web para ${lead.rubro} - conocé mi trabajo en ${SITIO_PRINCIPAL_APEX}`,
    `¿Te lo armamos con tu marca?`,
  ].join('\n')
}

async function claimYEnviarLead(
  sup: SupabaseClient,
  sender: PoolSender
): Promise<Record<string, unknown>> {
  const { data: candidatos, error: candidatosErr } = await sup
    .from(LEADS_TABLE)
    .select('*')
    .eq('origen', 'outbound')
    .eq('mensaje_enviado', false)
    .eq('estado', 'pendiente')
    .lt('primer_envio_intentos', MAX_REINTENTOS_LEAD)
    .not('telefono', 'is', null)
    .order('created_at', { ascending: true })
    .limit(50)

  if (candidatosErr) {
    console.error(`[cron] Error cargando candidatos: ${candidatosErr.message}`)
    return { status: 'error_candidatos', error: candidatosErr.message }
  }

  for (const lead of (candidatos ?? []) as LeadColaRow[]) {
    const verif = verificarNumeroWhatsApp(String(lead.telefono))
    if (!verif.valido) {
      await sup.from(LEADS_TABLE).update({
        estado: 'descartado',
        primer_envio_error: verif.razon,
        primer_envio_fallido_at: new Date().toISOString(),
        procesando_hasta: null,
      }).eq('id', lead.id)
      continue
    }

    const telefono = verif.normalizado
    if (isTelefonoHardBlocked(telefono)) {
      await sup.from(LEADS_TABLE).update({
        estado: 'descartado',
        primer_envio_error: 'telefono_bloqueado',
        primer_envio_fallido_at: new Date().toISOString(),
        procesando_hasta: null,
      }).eq('id', lead.id)
      continue
    }

    const telsMismaLinea = variantesTelefonoMismaLinea(telefono)
    const [{ data: yaConv }, { data: yaLead }, { data: yaConvPorLead }] = await Promise.all([
      sup.from('conversaciones').select('id').in('telefono', telsMismaLinea).limit(1).maybeSingle(),
      sup.from(LEADS_TABLE).select('id').in('telefono', telsMismaLinea).eq('mensaje_enviado', true).neq('id', lead.id).limit(1).maybeSingle(),
      sup.from('conversaciones').select('id').eq('lead_id', lead.id).limit(1).maybeSingle(),
    ])

    if (yaConv || yaLead || yaConvPorLead) {
      await sup.from(LEADS_TABLE).update({
        estado: 'contactado',
        mensaje_enviado: true,
        primer_envio_error: 'telefono_ya_contactado',
      }).eq('id', lead.id)
      continue
    }

    // Lock atómico del lead.
    const procesandoHasta = new Date(Date.now() + 5 * 60_000).toISOString()
    const { data: claimed } = await sup
      .from(LEADS_TABLE)
      .update({ procesando_hasta: procesandoHasta })
      .eq('id', lead.id)
      .eq('mensaje_enviado', false)
      .eq('estado', 'pendiente')
      .or(`procesando_hasta.is.null,procesando_hasta.lt.${new Date().toISOString()}`)
      .select('id')
      .maybeSingle()

    if (!claimed) continue // alguien más se lo llevó

    try {
      const mensajeTexto = construirMensajePrimerContacto(lead)
      const result = await enviarMensajeEvolution(telefono, mensajeTexto, sender.instance_name)

      // Increment atómico DESPUÉS del envío exitoso. Si falla por race no rollback
      // — el mensaje ya fue enviado. Solo se loggea.
      const incrementOk = await incrementMsgsToday(sup, sender.id)
      if (!incrementOk) {
        console.warn(`[cron] Race en increment tras envío exitoso. sender=${sender.id} lead=${lead.id}`)
      }

      await sup.from('conversaciones').insert({
        lead_id: lead.id,
        telefono,
        mensaje: mensajeTexto,
        rol: 'agente',
        tipo_mensaje: 'texto',
        manual: false,
        sender_id: sender.id,
        twilio_message_sid: result.messageId,
      })

      await sup.from(LEADS_TABLE).update({
        mensaje_enviado: true,
        estado: 'contactado',
        mensaje_inicial: mensajeTexto,
        primer_envio_completado_at: new Date().toISOString(),
        primer_envio_error: null,
        procesando_hasta: null,
      }).eq('id', lead.id)

      // Reset contador de fallos consecutivos del sender (sender está sano).
      await resetSendFailures(sup, sender.id)

      return {
        status: 'ok',
        lead_id: lead.id,
        nombre: lead.nombre,
        message_id: result.messageId,
        race_increment: !incrementOk,
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[cron] Error envío sender=${sender.instance_name} lead=${lead.id}:`, msg)

      // ── Liberar el lock SIEMPRE ──
      // (lo seteamos antes; si no liberamos, el lead queda 5 min en limbo aunque después lo
      // procesemos exitosamente con otro sender en el siguiente intento del pool).
      await sup.from(LEADS_TABLE).update({ procesando_hasta: null }).eq('id', lead.id)

      // ── Clasificar el error: del sender vs. del lead ──
      const isEvoErr = isEvolutionError(e)
      const code = isEvoErr ? e.code : null

      // Caso 1: la sesión Multi-Device del sender está caída (preflight detectó close).
      // No es culpa del lead → no incrementar intentos del lead.
      //
      // OUTAGE DETECTION (2026-05-20): antes marcábamos disconnected al toque, pero eso
      // crea un cascade-kill cuando Evolution está flakeando y devuelve `close` transitorio
      // a TODAS las instancias (que segundos antes estaban open). Cada tick mata un sender
      // distinto hasta dejar el pool seco. Ahora chequeamos si OTROS senders también cayeron
      // por preflight_close/connection_closed en los últimos OUTAGE_WINDOW_MS: si sí, no
      // marcamos disconnected y dejamos que health-evolution los recupere cuando Evolution
      // se estabilice.
      if (code === EVO_ERR.INSTANCE_NOT_CONNECTED) {
        const desdeOutage = new Date(Date.now() - OUTAGE_WINDOW_MS).toISOString()
        const { data: otrosFallando } = await sup
          .from('senders')
          .select('id')
          .eq('provider', 'evolution')
          .eq('activo', true)
          .eq('connected', false)
          .neq('id', sender.id)
          .gte('disconnected_at', desdeOutage)
          .in('disconnection_reason', ['preflight_close', 'connection_closed', 'send_failure_threshold'])

        if ((otrosFallando?.length ?? 0) >= OUTAGE_MIN_OTHER_SENDERS) {
          console.error(
            `[cron] sender ${sender.instance_name}: preflight close PERO ` +
            `${otrosFallando?.length} otros senders también disconnected en ${OUTAGE_WINDOW_MS / 60000}min → ` +
            `asumimos Evolution server outage, NO marcamos disconnected (health-evolution lo recuperará).`
          )
          return {
            status: 'evolution_server_outage_suspect_preflight',
            sender_id: sender.id,
            otros_disconnected: otrosFallando?.length,
            ultimo_error: msg,
          }
        }

        await markDisconnected(sup, sender.id, 'preflight_close')
        console.error(
          `[cron] sender ${sender.instance_name}: preflight detectó close → markDisconnected (failover)`
        )
        return {
          status: 'sender_caido_failover',
          sender_id: sender.id,
          ultimo_error: msg,
        }
      }

      // Caso 2: error 4xx de Evolution (número mal formado, contenido inválido).
      // Es culpa del lead. Incrementar intentos, descartar si llega al límite. Sender intacto.
      if (code === EVO_ERR.CLIENT_ERROR || code === EVO_ERR.TELEFONO_BLOQUEADO) {
        const nuevoIntentos = (lead.primer_envio_intentos ?? 0) + 1
        const esUltimoIntento = nuevoIntentos >= MAX_REINTENTOS_LEAD
        await sup.from(LEADS_TABLE).update({
          primer_envio_intentos: nuevoIntentos,
          primer_envio_error: msg.slice(0, 500),
          ...(esUltimoIntento ? { estado: 'descartado', primer_envio_fallido_at: new Date().toISOString() } : {}),
        }).eq('id', lead.id)
        return { status: 'lead_invalido', lead_id: lead.id, error: msg, code }
      }

      // Caso 3: timeout / 5xx / error desconocido. Tratamos como problema temporal/del sender.
      // Incrementar intentos del lead (porque sí gastó un slot del pool) y fallos del sender.
      // Si supera el umbral, marcar disconnected y failover.
      const nuevoIntentos = (lead.primer_envio_intentos ?? 0) + 1
      const esUltimoIntento = nuevoIntentos >= MAX_REINTENTOS_LEAD
      await sup.from(LEADS_TABLE).update({
        primer_envio_intentos: nuevoIntentos,
        primer_envio_error: msg.slice(0, 500),
        ...(esUltimoIntento ? { estado: 'descartado', primer_envio_fallido_at: new Date().toISOString() } : {}),
      }).eq('id', lead.id)

      const fallosAhora = await incrementSendFailures(sup, sender.id)

      if (fallosAhora >= MAX_FALLOS_CONSECUTIVOS) {
        // Antes de marcar este sender como muerto, chequear si OTROS senders
        // del pool también vienen fallando en los últimos OUTAGE_WINDOW_MS.
        // Si sí, es un outage de Evolution server (no este sender específico)
        // y NO debemos cascade-kill todo el pool — el cron health-evolution lo
        // recupera cuando Evolution responda bien de nuevo.
        const desdeOutage = new Date(Date.now() - OUTAGE_WINDOW_MS).toISOString()
        const { data: otrosFallando } = await sup
          .from('senders')
          .select('id')
          .eq('provider', 'evolution')
          .eq('activo', true)
          .eq('connected', false)
          .neq('id', sender.id)
          .gte('disconnected_at', desdeOutage)
          .in('disconnection_reason', ['send_failure_threshold', 'connection_closed', 'preflight_close'])

        if ((otrosFallando?.length ?? 0) >= OUTAGE_MIN_OTHER_SENDERS) {
          console.error(
            `[cron] sender ${sender.instance_name}: ${fallosAhora} fallos consecutivos PERO ` +
            `${otrosFallando?.length} otros senders también disconnected en ${OUTAGE_WINDOW_MS / 60000}min → ` +
            `asumimos Evolution server outage, NO marcamos disconnected (health-evolution lo recuperará).`
          )
          return {
            status: 'evolution_server_outage_suspect',
            sender_id: sender.id,
            fallos: fallosAhora,
            otros_disconnected: otrosFallando?.length,
            ultimo_error: msg,
          }
        }

        await markDisconnected(sup, sender.id, 'send_failure_threshold')
        console.error(
          `[cron] sender ${sender.instance_name}: ${fallosAhora} fallos consecutivos → markDisconnected (failover)`
        )
        return {
          status: 'sender_caido_failover',
          sender_id: sender.id,
          fallos: fallosAhora,
          ultimo_error: msg,
        }
      }

      return { status: 'envio_fallido', lead_id: lead.id, error: msg, fallos_sender: fallosAhora, code }
    }
  }

  return { status: 'sin_pendientes' }
}

/**
 * Health-check inline (piggyback): si pasaron más de INLINE_HEALTH_THROTTLE_MS
 * desde el último health-check de cualquier sender, ejecutamos un sync con
 * Evolution. No-op si el cron Vercel /api/cron/health-evolution ya está
 * cumpliendo. Defensivo: una sola query DB para chequear staleness.
 */
async function ejecutarHealthCheckInlineSiCorresponde(sup: SupabaseClient): Promise<void> {
  const { data: ultimoCheck } = await sup
    .from('senders')
    .select('health_checked_at')
    .eq('provider', 'evolution')
    .eq('activo', true)
    .order('health_checked_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  const lastCheckAt = ultimoCheck?.health_checked_at
    ? new Date(ultimoCheck.health_checked_at).getTime()
    : 0
  const stale = Date.now() - lastCheckAt > INLINE_HEALTH_THROTTLE_MS
  if (!stale) return

  try {
    const { data: senders } = await sup
      .from('senders')
      .select('id, alias, instance_name, connected, disconnected_at, disconnection_reason')
      .eq('provider', 'evolution')
      .eq('activo', true)

    const senderRows = senders ?? []
    if (senderRows.length === 0) return

    const instances = await fetchAllInstances()
    const byName = new Map(instances.map(i => [i.name, i]))

    for (const s of senderRows) {
      const evo = byName.get(s.instance_name as string)
      const evoState = evo?.state ?? null
      const evoPhone = evo?.phone ?? null
      if (evoState === 'connecting') {
        await sup.from('senders').update({ health_checked_at: new Date().toISOString() }).eq('id', s.id as string)
        continue
      }
      const nextConnected = evoState === 'open'
      const changed = nextConnected !== s.connected
      const isFirstDetect = !nextConnected && (changed || s.disconnected_at === null)
      let reason: string | null = null
      if (!nextConnected && isFirstDetect) {
        if (evoState === 'close') reason = 'health_check_close'
        else if (evoState == null) reason = 'health_check_instance_missing'
        else reason = `health_check_${evoState}`
      }
      try {
        await updateHealthCheck(sup, s.id as string, {
          connected: nextConnected,
          reason,
          phoneNumber: evoPhone,
          preserveDisconnectedAt: !nextConnected && !isFirstDetect,
        })
        if (changed) {
          console.log(
            `[cron inline-health] ${s.alias ?? s.instance_name}: ` +
            `${s.connected}→${nextConnected} (${reason ?? 'open'})`
          )
        }
      } catch (e) {
        console.warn(`[cron inline-health] sync ${s.instance_name} falló:`, e instanceof Error ? e.message : e)
      }
    }
  } catch (err) {
    console.warn(`[cron inline-health] fetchAllInstances falló (no bloquea cron):`, err instanceof Error ? err.message : err)
  }
}

async function procesarUnTick(
  sup: SupabaseClient,
  forced: boolean
): Promise<Record<string, unknown>> {
  await resetDailyCountersIfNeeded(sup)
  await ejecutarHealthCheckInlineSiCorresponde(sup)

  const { data: cfgActivo } = await sup
    .from('configuracion').select('valor').eq('clave', 'first_contact_activo').maybeSingle()
  if (cfgActivo?.valor !== 'true') {
    return { status: 'skipped_first_contact_inactivo' }
  }

  if (!forced && !estaEnVentanaPrimerContacto()) {
    return {
      status: 'fuera_de_ventana',
      hora_argentina: getHoraArgentina(),
      ventana: { inicio: PRIMER_CONTACTO_HORA_INICIO_AR, fin: PRIMER_CONTACTO_HORA_FIN_AR },
    }
  }

  // Reintentar hasta MAX_REINTENTOS_POOL veces si el sender elegido se cae.
  // Cada iteración: selectNextSender excluirá automáticamente al que recién marcamos
  // disconnected porque markDisconnected pone connected=false. Para los casos
  // outage_suspect (donde el sender NO se marca disconnected pero falló este tick),
  // pasamos excludeIds para que no lo vuelva a elegir en este mismo tick.
  const sendersIntentados: string[] = []
  const sendersIntentadosIds: string[] = []
  for (let intentoPool = 0; intentoPool < MAX_REINTENTOS_POOL; intentoPool++) {
    const sender = await selectNextSender(sup, { excludeIds: sendersIntentadosIds })
    if (!sender) {
      return {
        status: 'pool_agotado',
        intento: intentoPool + 1,
        senders_intentados: sendersIntentados,
      }
    }
    sendersIntentados.push(sender.alias ?? sender.instance_name)
    sendersIntentadosIds.push(sender.id)

    const leadResult = await claimYEnviarLead(sup, sender)

    if (leadResult.status === 'sin_pendientes') {
      return { status: 'sin_pendientes', sender_intentado: sender.alias ?? sender.instance_name }
    }

    // Failover: el sender elegido está caído. Reintentar con el siguiente del pool.
    if (leadResult.status === 'sender_caido_failover') {
      console.warn(
        `[cron] failover #${intentoPool + 1}: sender ${sender.alias ?? sender.instance_name} marcado disconnected, reintentando con siguiente`
      )
      continue
    }

    // Outage suspect: este sender específico falló con sintomas de "Evolution flakeando",
    // pero no lo marcamos disconnected porque ya hay otros con el mismo síntoma reciente.
    // Sin embargo, otros senders podrían NO estar flakeando — vale la pena reintentar con
    // el siguiente del pool antes de rendirnos. Si TODOS dan outage_suspect, el loop sale
    // por agotamiento de MAX_REINTENTOS_POOL con status pool_agotado_failover.
    if (
      leadResult.status === 'evolution_server_outage_suspect_preflight' ||
      leadResult.status === 'evolution_server_outage_suspect'
    ) {
      console.warn(
        `[cron] outage suspect #${intentoPool + 1}: sender ${sender.alias ?? sender.instance_name} falló pero NO marcado disconnected (outage protection); probando siguiente sender del pool.`
      )
      continue
    }

    if (leadResult.status === 'race_pool') {
      // El sender se nos escapó entre select e increment — reintento.
      continue
    }

    return {
      ...leadResult,
      sender: { id: sender.id, alias: sender.alias, instance_name: sender.instance_name },
      senders_intentados: sendersIntentados,
    }
  }

  return { status: 'pool_agotado_failover', senders_intentados: sendersIntentados }
}

export async function GET(req: NextRequest) {
  if (!authCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const forced = req.nextUrl.searchParams.get('force') === 'true'
  const sup = createSupabaseServer()

  const result = await procesarUnTick(sup, forced)
  return NextResponse.json({ ok: true, tick: result })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
