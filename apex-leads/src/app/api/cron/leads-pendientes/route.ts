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
import { enviarMensajeEvolution } from '@/lib/evolution'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TZ_OFFSET_HOURS_AR = -3
const LEADS_TABLE = 'leads'
const MAX_REINTENTOS = 3
// Límite diario de mensajes por sender. Se respeta aunque ?force=true no lo omite.
const MAX_DIARIO_POR_SENDER = 200
// Cuántos leads intentar por tick antes de rendirse
const MAX_LEADS_POR_TICK = 10

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

interface SenderRow {
  id: string
  instance_name: string
  phone_number: string
  alias: string | null
  activo: boolean
}

function authCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

function fechaArHoy(): string {
  const ar = new Date(Date.now() + TZ_OFFSET_HOURS_AR * 3600_000)
  return ar.toISOString().slice(0, 10)
}

function minAleatorio(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

async function leerConfig(sup: SupabaseClient, clave: string, def: string): Promise<string> {
  const { data } = await sup.from('configuracion').select('valor').eq('clave', clave).maybeSingle()
  return data?.valor ?? def
}

async function escribirConfig(sup: SupabaseClient, clave: string, valor: string) {
  await sup.from('configuracion').upsert({ clave, valor }, { onConflict: 'clave' })
}

async function actualizarLead(sup: SupabaseClient, id: string, updates: Record<string, unknown>) {
  const { error } = await sup.from(LEADS_TABLE).update(updates).eq('id', id)
  if (error) console.error('[cron leads-pendientes] Error update lead:', error.message)
}

async function leerDailyCount(sup: SupabaseClient, key: string): Promise<number> {
  const raw = await leerConfig(sup, `${key}_primer_enviados_hoy`, `0|1970-01-01`)
  const [countStr, fecha] = raw.split('|')
  return fecha === fechaArHoy() ? (parseInt(countStr, 10) || 0) : 0
}

async function incrementarDailyCount(sup: SupabaseClient, key: string, actual: number) {
  await escribirConfig(sup, `${key}_primer_enviados_hoy`, `${actual + 1}|${fechaArHoy()}`)
}

// Construye el mensaje de primer contacto como texto libre (sin template Meta).
// El mismo texto se usa para el envío y para guardar en la tabla conversaciones.
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

// ─── Procesar un sender ────────────────────────────────────────────────────────
async function procesarSender(
  sup: SupabaseClient,
  sender: SenderRow,
  forced: boolean,
  yaProcesoIds: string[]
): Promise<Record<string, unknown>> {
  const key = sender.instance_name

  console.log(`[DBG sender] ── INICIO procesarSender key=${key} phone=${sender.phone_number} forced=${forced} ──`)

  if (!sender.activo) {
    console.log(`[DBG sender] [${key}] → INACTIVO en DB`)
    return { status: 'inactivo' }
  }

  const fallosActuales = parseInt(await leerConfig(sup, `${key}_primer_fallos`, '0'), 10) || 0
  console.log(`[DBG sender] [${key}] senderId=${sender.id} fallosActuales=${fallosActuales}`)

  if (!forced && !estaEnVentanaPrimerContacto()) {
    const h = getHoraArgentina()
    console.log(`[DBG sender] [${key}] → fuera_de_ventana hora=${h}`)
    return {
      status: 'fuera_de_ventana',
      hora_argentina: h,
      ventana: {
        inicio: PRIMER_CONTACTO_HORA_INICIO_AR,
        fin: PRIMER_CONTACTO_HORA_FIN_AR,
      },
    }
  }

  const enviados = await leerDailyCount(sup, key)
  console.log(`[DBG sender] [${key}] enviados_hoy=${enviados}/${MAX_DIARIO_POR_SENDER}`)

  if (!forced && enviados >= MAX_DIARIO_POR_SENDER) {
    console.log(`[DBG sender] [${key}] → limite_diario_alcanzado (${enviados}/${MAX_DIARIO_POR_SENDER})`)
    return {
      status: 'limite_diario_alcanzado',
      enviados_hoy: enviados,
      limite: MAX_DIARIO_POR_SENDER,
    }
  }

  // Slot de cadencia (por ahora sin delay: intMin=intMax=0)
  // Para agregar delay por sender, agregar columnas int_min/int_max a la tabla senders.
  const nextSlotStr = await leerConfig(sup, `${key}_primer_next_slot_at`, '1970-01-01T00:00:00.000Z')
  if (!forced && new Date(nextSlotStr).getTime() > Date.now()) {
    const faltanMin = Math.ceil((new Date(nextSlotStr).getTime() - Date.now()) / 60_000)
    console.log(`[DBG sender] [${key}] → slot_no_alcanzado next=${nextSlotStr} faltan=${faltanMin}min`)
    return { status: 'slot_no_alcanzado', next_slot_at: nextSlotStr, faltan_min: faltanMin }
  }

  const erroresTick: Array<{ lead_id: string; error: string }> = []

  for (let i = 0; i < MAX_LEADS_POR_TICK; i++) {
    console.log(`[DBG sender] [${key}] ── intento ${i + 1}/${MAX_LEADS_POR_TICK} ──`)

    const { data: candidatos, error: candidatosErr } = await sup
      .from(LEADS_TABLE)
      .select('*')
      .eq('origen', 'outbound')
      .eq('mensaje_enviado', false)
      .eq('estado', 'pendiente')
      .lt('primer_envio_intentos', MAX_REINTENTOS)
      .not('telefono', 'is', null)
      .order('created_at', { ascending: true })
      .limit(200)

    console.log(`[DBG sender] [${key}] candidatos DB: count=${candidatos?.length ?? 0} error=${candidatosErr?.message ?? 'none'}`)

    const lead = (candidatos ?? []).find(
      (l: LeadColaRow) => !yaProcesoIds.includes(l.id)
    ) as LeadColaRow | undefined

    if (!lead) {
      console.log(`[DBG sender] [${key}] → sin lead disponible`)
      return {
        status: erroresTick.length > 0 ? 'error_sin_mas_candidatos' : 'sin_pendientes',
        errores: erroresTick,
      }
    }

    console.log(`[DBG sender] [${key}] lead elegido id=${lead.id} tel_raw=${lead.telefono} nombre=${lead.nombre} intentos=${lead.primer_envio_intentos}`)
    yaProcesoIds.push(lead.id)

    const verificacion = verificarNumeroWhatsApp(String(lead.telefono))
    console.log(`[DBG sender] [${key}] verificacion tel="${lead.telefono}": ${JSON.stringify(verificacion)}`)

    if (!verificacion.valido) {
      console.warn(`[DBG sender] [${key}] verificacion fallida razon=${verificacion.razon} → descartando`)
      await actualizarLead(sup, lead.id, {
        estado: 'descartado',
        primer_envio_error: verificacion.razon,
        primer_envio_fallido_at: new Date().toISOString(),
        procesando_hasta: null,
      })
      continue
    }

    const telefono = verificacion.normalizado
    const telsMismaLinea = variantesTelefonoMismaLinea(telefono)

    if (isTelefonoHardBlocked(telefono)) {
      await actualizarLead(sup, lead.id, {
        estado: 'descartado',
        primer_envio_error: 'telefono_bloqueado',
        primer_envio_fallido_at: new Date().toISOString(),
        procesando_hasta: null,
      })
      console.warn(`[DBG sender] [${key}] tel ${telefono} bloqueado → saltando`)
      continue
    }

    const [{ data: yaConv }, { data: yaLead }, { data: yaConvPorLead }] = await Promise.all([
      sup.from('conversaciones').select('id').in('telefono', telsMismaLinea).limit(1).maybeSingle(),
      sup
        .from(LEADS_TABLE)
        .select('id')
        .in('telefono', telsMismaLinea)
        .eq('mensaje_enviado', true)
        .neq('id', lead.id)
        .limit(1)
        .maybeSingle(),
      sup.from('conversaciones').select('id').eq('lead_id', lead.id).limit(1).maybeSingle(),
    ])

    console.log(`[DBG sender] [${key}] yaConv=${!!yaConv} yaLead=${!!yaLead} yaConvPorLead=${!!yaConvPorLead}`)

    if (yaConv || yaLead || yaConvPorLead) {
      await actualizarLead(sup, lead.id, {
        estado: 'contactado',
        mensaje_enviado: true,
        primer_envio_error: 'telefono_ya_contactado',
      })
      console.warn(`[DBG sender] [${key}] tel ${telefono} ya contactado → saltando`)
      continue
    }

    // Lock atómico
    const procesandoHasta = new Date(Date.now() + 5 * 60_000).toISOString()
    const { data: claimed, error: claimErr } = await sup
      .from(LEADS_TABLE)
      .update({ procesando_hasta: procesandoHasta })
      .eq('id', lead.id)
      .eq('mensaje_enviado', false)
      .eq('estado', 'pendiente')
      .or(`procesando_hasta.is.null,procesando_hasta.lt.${new Date().toISOString()}`)
      .select('id')
      .maybeSingle()

    console.log(`[DBG sender] [${key}] claim lead ${lead.id}: claimed=${!!claimed} claimErr=${claimErr?.message ?? 'none'}`)

    if (claimErr || !claimed) {
      console.warn(`[DBG sender] [${key}] lead ${lead.id} ya reclamado → saltando`)
      continue
    }

    try {
      const mensajeTexto = construirMensajePrimerContacto(lead)
      const result = await enviarMensajeEvolution(telefono, mensajeTexto, key)

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

      await actualizarLead(sup, lead.id, {
        mensaje_enviado: true,
        estado: 'contactado',
        mensaje_inicial: mensajeTexto,
        primer_envio_completado_at: new Date().toISOString(),
        primer_envio_error: null,
        procesando_hasta: null,
      })

      await incrementarDailyCount(sup, key, enviados)
      await escribirConfig(sup, `${key}_primer_fallos`, '0')

      // Sin delay entre envíos por defecto; agregar lógica de slot si se necesita
      const proximoMin = minAleatorio(0, 0)
      await escribirConfig(sup, `${key}_primer_next_slot_at`, '1970-01-01T00:00:00.000Z')

      return {
        status: 'ok',
        lead_id: lead.id,
        nombre: lead.nombre,
        message_id: result.messageId,
        enviados_hoy: enviados + 1,
        intentos_hasta_envio: i + 1,
        ...(erroresTick.length > 0 ? { saltados: erroresTick.length } : {}),
        proximo_min: proximoMin,
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const stack = e instanceof Error ? (e.stack ?? '') : ''
      console.error(`[DBG sender] [${key}] ❌ CATCH lead=${lead.id} error="${msg}"`)
      console.error(`[DBG sender] [${key}] stack: ${stack.slice(0, 800)}`)

      erroresTick.push({ lead_id: lead.id, error: msg })

      const nuevoIntentos = (lead.primer_envio_intentos ?? 0) + 1
      const esUltimoIntento = nuevoIntentos >= MAX_REINTENTOS
      await actualizarLead(sup, lead.id, {
        primer_envio_intentos: nuevoIntentos,
        primer_envio_error: msg.slice(0, 500),
        procesando_hasta: null,
        ...(esUltimoIntento
          ? { estado: 'descartado', primer_envio_fallido_at: new Date().toISOString() }
          : {}),
      })

      const fallosAntes = parseInt(await leerConfig(sup, `${key}_primer_fallos`, '0'), 10) || 0
      const fallos = fallosAntes + 1
      await escribirConfig(sup, `${key}_primer_fallos`, String(fallos))

      console.error(`[DBG sender] [${key}] fallos_sender=${fallos}/10`)

      if (fallos >= 10) {
        await sup.from('senders').update({ activo: false }).eq('id', sender.id)
        console.error(`[DBG sender] [${key}] ❌❌ 10 fallos consecutivos → SENDER PAUSADO`)
        return {
          status: 'pausado_auto',
          lead_id: lead.id,
          error: msg,
          fallos_consecutivos: fallos,
          errores_tick: erroresTick,
        }
      }

      console.warn(`[DBG sender] [${key}] fallo ${fallos}/10 → continuando con siguiente lead`)
    }
  }

  return { status: 'error_max_intentos_tick', intentos: MAX_LEADS_POR_TICK, errores: erroresTick }
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  console.log(`[DBG cron] ════ TICK INICIO ${new Date().toISOString()} ════`)

  if (!authCron(req)) {
    console.warn(`[DBG cron] ❌ Auth fallida. CRON_SECRET=${process.env.CRON_SECRET ? 'SET' : 'FALTA'}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const forced = req.nextUrl.searchParams.get('force') === 'true'
  console.log(`[DBG cron] forced=${forced}`)

  const sup = createSupabaseServer()

  console.log(`[DBG cron] ENV: EVOLUTION_API_URL=${process.env.EVOLUTION_API_URL ? 'SET' : 'FALTA'} EVOLUTION_API_KEY=${process.env.EVOLUTION_API_KEY ? 'SET' : 'FALTA'}`)

  // Verificar interruptor global
  const { data: cfgActivo } = await sup
    .from('configuracion').select('valor').eq('clave', 'first_contact_activo').maybeSingle()
  console.log(`[DBG cron] first_contact_activo=${cfgActivo?.valor}`)
  if (cfgActivo?.valor !== 'true') {
    return NextResponse.json({ ok: true, skipped: 'first_contact_inactivo' })
  }

  // Cargar senders activos desde DB (N instancias Evolution API)
  const { data: sendersDB, error: sendersErr } = await sup
    .from('senders')
    .select('id, instance_name, phone_number, alias, activo')
    .eq('provider', 'evolution')
    .eq('activo', true)
    .not('instance_name', 'is', null)

  if (sendersErr) {
    console.error('[DBG cron] Error cargando senders:', sendersErr.message)
    return NextResponse.json({ error: sendersErr.message }, { status: 500 })
  }

  const senders = (sendersDB ?? []) as SenderRow[]
  console.log(`[DBG cron] senders activos: ${senders.length}`)

  if (senders.length === 0) {
    return NextResponse.json({ ok: true, skipped: 'sin_senders_activos' })
  }

  const yaProcesoIds: string[] = []
  const results: Record<string, unknown> = {}

  for (const sender of senders) {
    results[sender.instance_name] = await procesarSender(sup, sender, forced, yaProcesoIds)
  }

  return NextResponse.json({ ok: true, results })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
