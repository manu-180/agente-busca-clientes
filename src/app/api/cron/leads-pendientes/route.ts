import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { normalizarTelefonoArg, variantesTelefonoMismaLinea } from '@/lib/phone'
import { isTelefonoHardBlocked } from '@/lib/phone-blocklist'
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

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TZ_OFFSET_HOURS_AR = -3
const LEADS_TABLE = 'leads'
const MAX_REINTENTOS = 3
const TWILIO_CONTENT_SID = 'HXd09b087b8ee1390b5c8aacff30598281'

// ─── Senders Twilio (primer contacto) ────────────────────────────────────────
// Cadencia intMin/intMax en minutos; si ambos ≤ 0 no hay espera entre envíos.
// Ventana horaria 7:00–21:00 (America/Argentina/Buenos_Aires); ?force=true omite.
interface SenderDef {
  key: string
  provider: 'twilio'
  phoneNumber: string
  contentSid: string
  intMin: number
  intMax: number
}

const SENDERS: SenderDef[] = [
  {
    key: 'twilio_1',
    provider: 'twilio',
    phoneNumber: '+5491124843094',
    contentSid: TWILIO_CONTENT_SID,
    intMin: 0,
    intMax: 0,
  },
  {
    key: 'twilio_2',
    provider: 'twilio',
    phoneNumber: '+5491124842720',
    contentSid: TWILIO_CONTENT_SID,
    intMin: 0,
    intMax: 0,
  },
]
// ──────────────────────────────────────────────────────────────────────────────

type SupabaseClient = ReturnType<typeof createSupabaseServer>

interface LeadColaRow {
  id: string
  nombre: string
  rubro: string
  zona: string
  telefono: string
  instagram: string | null
  /** Incluye "Rating: X/5" cuando el lead viene de búsqueda (ver NuevoLeadClient). */
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

function fechaArHoy(): string {
  const ar = new Date(Date.now() + TZ_OFFSET_HOURS_AR * 3600_000)
  return ar.toISOString().slice(0, 10) // YYYY-MM-DD
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

// Daily count — stored as "N|YYYY-MM-DD". Se resetea automáticamente al cambiar el día.
async function leerDailyCount(sup: SupabaseClient, key: string): Promise<number> {
  const raw = await leerConfig(sup, `${key}_primer_enviados_hoy`, `0|1970-01-01`)
  const [countStr, fecha] = raw.split('|')
  return fecha === fechaArHoy() ? (parseInt(countStr, 10) || 0) : 0
}

async function incrementarDailyCount(sup: SupabaseClient, key: string, actual: number) {
  await escribirConfig(sup, `${key}_primer_enviados_hoy`, `${actual + 1}|${fechaArHoy()}`)
}


// Envía mensaje con template de Twilio (HSM pre-aprobado por Meta)
// Variables: 1=nombre, 2=rating, 3=demo (host), 4=localidad, 5=rubro búsqueda, 6=sitio principal
// Retorna el MessageSid de Twilio para tracking asíncrono de entrega.
async function enviarTemplateTwilio(
  telefono: string,
  fromNumber: string,
  contentSid: string,
  vars: {
    nombre: string
    rating: string
    demoHost: string
    zona: string
    rubro: string
    sitioPrincipal: string
  }
): Promise<string> {
  if (isTelefonoHardBlocked(telefono)) {
    throw new Error('TELEFONO_BLOQUEADO')
  }
  const accountSid = process.env.TWILIO_ACCOUNT_SID!
  const auth = 'Basic ' + Buffer.from(`${accountSid}:${process.env.TWILIO_AUTH_TOKEN!}`).toString('base64')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://leads.theapexweb.com'

  const params = {
    From: `whatsapp:${fromNumber}`,
    To: `whatsapp:+${telefono}`,
    ContentSid: contentSid,
    ContentVariables: JSON.stringify({
      '1': vars.nombre,
      '2': vars.rating,
      '3': vars.demoHost,
      '4': vars.zona,
      '5': vars.rubro,
      '6': vars.sitioPrincipal,
    }),
    StatusCallback: `${appUrl}/api/webhook/twilio-status`,
  }

  console.log(`[DBG twilio] POST Messages.json From=${params.From} To=${params.To} ContentSid=${contentSid}`)
  console.log(`[DBG twilio] ContentVariables=${params.ContentVariables}`)
  console.log(`[DBG twilio] StatusCallback=${params.StatusCallback}`)

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    }
  )

  console.log(`[DBG twilio] httpStatus=${res.status}`)

  if (!res.ok) {
    const err = await res.text()
    console.error(`[DBG twilio] error body: ${err.slice(0, 500)}`)
    throw new Error(`Twilio template error ${res.status}: ${err}`)
  }

  const body = await res.json()
  console.log(`[DBG twilio] OK sid=${body.sid} status=${body.status}`)
  return body.sid as string
}

// Cuántos leads intentar por tick antes de rendirse
const MAX_LEADS_POR_TICK = 10

// ─── Procesar un sender ────────────────────────────────────────────────────────
// Itera leads hasta enviar uno exitosamente (o agotar MAX_LEADS_POR_TICK).
// Si falla 10 veces consecutivas entre ticks, pausa el sender automáticamente.
async function procesarSender(
  sup: SupabaseClient,
  sender: SenderDef,
  forced: boolean,
  yaProcesoIds: string[]  // leads tomados en este tick por el otro sender
): Promise<Record<string, unknown>> {
  const { key, provider, phoneNumber, contentSid, intMin, intMax } = sender

  console.log(`[DBG sender] ── INICIO procesarSender key=${key} phone=${phoneNumber} forced=${forced} ──`)

  // 1. Verificar sender en tabla senders (activo + id para taggear conversaciones)
  const { data: senderRow, error: senderErr } = await sup
    .from('senders')
    .select('id, activo')
    .eq('provider', provider)
    .eq('phone_number', phoneNumber)
    .maybeSingle()

  console.log(`[DBG sender] [${key}] senderRow=${JSON.stringify(senderRow)} error=${senderErr?.message ?? 'none'}`)

  if (senderRow && !senderRow.activo) {
    console.log(`[DBG sender] [${key}] → INACTIVO en DB`)
    return { status: 'inactivo' }
  }

  if (!senderRow) {
    console.warn(`[DBG sender] [${key}] ⚠ NO se encontró fila en tabla senders para phone=${phoneNumber}`)
  }

  const senderId = senderRow?.id ?? null
  const fallosActuales = parseInt(await leerConfig(sup, `${key}_primer_fallos`, '0'), 10) || 0
  console.log(`[DBG sender] [${key}] senderId=${senderId} fallosActuales=${fallosActuales}`)

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

  // 2. Contador diario (métrica / diagnóstico; no condiciona envíos)
  const enviados = await leerDailyCount(sup, key)
  console.log(`[DBG sender] [${key}] enviados_hoy=${enviados}`)

  // 3. Slot de cadencia (omitido si intMin e intMax son ≤ 0)
  if (!forced && (intMin > 0 || intMax > 0)) {
    const nextSlotStr = await leerConfig(sup, `${key}_primer_next_slot_at`, '1970-01-01T00:00:00.000Z')
    if (new Date(nextSlotStr).getTime() > Date.now()) {
      const faltanMin = Math.ceil((new Date(nextSlotStr).getTime() - Date.now()) / 60_000)
      console.log(`[DBG sender] [${key}] → slot_no_alcanzado next=${nextSlotStr} faltan=${faltanMin}min`)
      return { status: 'slot_no_alcanzado', next_slot_at: nextSlotStr, faltan_min: faltanMin }
    }
  }

  // 4. Loop: intentar leads hasta mandar uno o agotar MAX_LEADS_POR_TICK
  const erroresTick: Array<{ lead_id: string; error: string }> = []

  for (let i = 0; i < MAX_LEADS_POR_TICK; i++) {
    console.log(`[DBG sender] [${key}] ── intento ${i + 1}/${MAX_LEADS_POR_TICK} ──`)

    // Elegir lead: el más antiguo en cola (FIFO) que no haya tomado el otro sender en este tick
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
      console.log(`[DBG sender] [${key}] → sin lead disponible (todos tomados o cola vacía)`)
      return {
        status: erroresTick.length > 0 ? 'error_sin_mas_candidatos' : 'sin_pendientes',
        errores: erroresTick,
      }
    }

    console.log(`[DBG sender] [${key}] lead elegido id=${lead.id} tel_raw=${lead.telefono} nombre=${lead.nombre} intentos=${lead.primer_envio_intentos}`)

    // Reservar para que el otro sender no lo tome en el mismo tick
    yaProcesoIds.push(lead.id)

    const telefono = normalizarTelefonoArg(String(lead.telefono))
    console.log(`[DBG sender] [${key}] tel normalizado: "${lead.telefono}" → "${telefono}"`)

    if (!telefono) {
      console.warn(`[DBG sender] [${key}] tel inválido tras normalizar → descartando`)
      await actualizarLead(sup, lead.id, { estado: 'descartado', primer_envio_error: 'telefono_invalido' })
      continue
    }

    if (isTelefonoHardBlocked(telefono)) {
      await actualizarLead(sup, lead.id, {
        estado: 'descartado',
        primer_envio_error: 'telefono_bloqueado_lista',
        procesando_hasta: null,
      })
      console.warn(`[DBG sender] [${key}] tel ${telefono} en lista de bloqueo → descartado`)
      continue
    }

    const telsMismaLinea = variantesTelefonoMismaLinea(telefono)
    console.log(`[DBG sender] [${key}] variantes misma línea: ${JSON.stringify(telsMismaLinea)}`)

    // Evitar spam: saltar si el teléfono ya tiene conversación previa o fue enviado antes
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
      console.warn(`[DBG sender] [${key}] lead ${lead.id} ya reclamado por otro proceso → saltando`)
      continue
    }

    try {
      // Nota: La validación síncrona de WhatsApp via Twilio Lookup API v2
      // no está disponible (el campo 'whatsapp' fue removido de esa API).
      // Los números sin WA se detectan de forma asíncrona por el webhook
      // /api/webhook/twilio-status cuando Twilio reporta error 63024.

      const ratingStr = extraerRatingParaPlantilla(lead.descripcion)
      const demoHost = resolveWhatsAppDemoHost(lead.rubro, lead.descripcion)
      const vars = {
        nombre: lead.nombre,
        rating: ratingStr,
        demoHost,
        zona: lead.zona,
        rubro: lead.rubro,
        sitioPrincipal: SITIO_PRINCIPAL_APEX,
      }
      const messageSid = await enviarTemplateTwilio(telefono, phoneNumber, contentSid, vars)
      const mensajeGuardado = [
        `Hola ${lead.nombre}`,
        `Vi que tu negocio tiene ${ratingStr}⭐ en Google Maps.`,
        `Hice este boceto para un negocio como el tuyo: ${demoHost}`,
        `Trabajo con negocios de ${lead.zona} haciendo páginas web para ${lead.rubro} - conocé mi trabajo en ${SITIO_PRINCIPAL_APEX}`,
        `¿Te lo armamos con tu marca?`,
      ].join('\n')

      // Guardar conversación con SID para tracking asíncrono de entrega
      await sup.from('conversaciones').insert({
        lead_id: lead.id,
        telefono,
        mensaje: mensajeGuardado,
        rol: 'agente',
        tipo_mensaje: 'texto',
        manual: false,
        sender_id: senderId,
        twilio_message_sid: messageSid,
      })

      await actualizarLead(sup, lead.id, {
        mensaje_enviado: true,
        estado: 'contactado',
        mensaje_inicial: mensajeGuardado,
        primer_envio_completado_at: new Date().toISOString(),
        primer_envio_error: null,
      })

      // Éxito: reset fallos, avanzar slot y contador
      await incrementarDailyCount(sup, key, enviados)
      await escribirConfig(sup, `${key}_primer_fallos`, '0')
      let proximoSlot: Date | null = null
      let proximoMin = 0
      if (intMin > 0 || intMax > 0) {
        proximoMin = minAleatorio(intMin, intMax)
        proximoSlot = new Date(Date.now() + proximoMin * 60_000)
        await escribirConfig(sup, `${key}_primer_next_slot_at`, proximoSlot.toISOString())
      } else {
        await escribirConfig(sup, `${key}_primer_next_slot_at`, '1970-01-01T00:00:00.000Z')
      }

      return {
        status: 'ok',
        lead_id: lead.id,
        nombre: lead.nombre,
        twilio_message_sid: messageSid,
        enviados_hoy: enviados + 1,
        proximo_slot_at: proximoSlot?.toISOString() ?? null,
        proximo_min: proximoMin,
        intentos_hasta_envio: i + 1,
        ...(erroresTick.length > 0 ? { saltados: erroresTick.length } : {}),
      }

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const stack = e instanceof Error ? (e.stack ?? '') : ''
      console.error(`[DBG sender] [${key}] ❌ CATCH lead=${lead.id} error="${msg}"`)
      console.error(`[DBG sender] [${key}] stack: ${stack.slice(0, 800)}`)

      erroresTick.push({ lead_id: lead.id, error: msg })

      await actualizarLead(sup, lead.id, {
        primer_envio_intentos: (lead.primer_envio_intentos ?? 0) + 1,
        primer_envio_error: msg.slice(0, 500),
      })

      const fallosAntes = parseInt(await leerConfig(sup, `${key}_primer_fallos`, '0'), 10) || 0
      const fallos = fallosAntes + 1
      await escribirConfig(sup, `${key}_primer_fallos`, String(fallos))

      console.error(`[DBG sender] [${key}] fallos_sender=${fallos}/10`)

      if (fallos >= 10) {
        if (senderRow?.id) {
          await sup.from('senders').update({ activo: false }).eq('id', senderRow.id)
        }
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
    console.warn(`[DBG cron] ❌ Auth fallida. Header authorization=${req.headers.get('authorization')?.slice(0, 20)}… CRON_SECRET=${process.env.CRON_SECRET ? 'SET('+process.env.CRON_SECRET.length+'chars)' : 'FALTA'}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const forced = req.nextUrl.searchParams.get('force') === 'true'
  console.log(`[DBG cron] forced=${forced}`)

  const sup = createSupabaseServer()

  // Verificar variables de entorno críticas
  console.log(`[DBG cron] ENV: TWILIO_ACCOUNT_SID=${process.env.TWILIO_ACCOUNT_SID ? 'SET' : 'FALTA'} TWILIO_AUTH_TOKEN=${process.env.TWILIO_AUTH_TOKEN ? 'SET' : 'FALTA'} NEXT_PUBLIC_APP_URL=${process.env.NEXT_PUBLIC_APP_URL ?? '(no seteada, usará default)'}`)

  // Verificar interruptor global
  const { data: cfgActivo } = await sup
    .from('configuracion').select('valor').eq('clave', 'first_contact_activo').maybeSingle()
  console.log(`[DBG cron] first_contact_activo=${cfgActivo?.valor}`)
  if (cfgActivo?.valor !== 'true') {
    return NextResponse.json({ ok: true, skipped: 'first_contact_inactivo' })
  }

  // Cada sender corre de forma independiente y secuencial.
  // yaProcesoIds previene que ambos tomen el mismo lead en el mismo tick.
  const yaProcesoIds: string[] = []
  const results: Record<string, unknown> = {}

  for (const sender of SENDERS) {
    results[sender.key] = await procesarSender(sup, sender, forced, yaProcesoIds)
  }

  return NextResponse.json({ ok: true, results })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
