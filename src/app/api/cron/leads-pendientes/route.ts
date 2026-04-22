import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { normalizarTelefonoArg, variantesTelefonoMismaLinea } from '@/lib/phone'
import { isTelefonoHardBlocked } from '@/lib/phone-blocklist'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TZ_OFFSET_HOURS_AR = -3
const LEADS_TABLE = 'leads'
const MAX_REINTENTOS = 3
const HORA_INICIO_AR = 8
/** Última hora permitida (inclusive): se envía durante 8:00–20:59 AR. */
const HORA_FIN_AR = 20

// ─── Senders Twilio (primer contacto) ────────────────────────────────────────
// Cadencia intMin/intMax en minutos; si ambos ≤ 0 no hay espera entre envíos
// (solo aplica la ventana horaria). Sin tope diario de cantidad.
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
    contentSid: 'HXeab2f108288fe221bce43ebe6565912a',
    intMin: 0,
    intMax: 0,
  },
  {
    key: 'twilio_2',
    provider: 'twilio',
    phoneNumber: '+5491124842720',
    contentSid: 'HXeab2f108288fe221bce43ebe6565912a',
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
async function enviarTemplateTwilio(
  telefono: string,
  nombre: string,
  zona: string,
  rubro: string,
  fromNumber: string,
  contentSid: string
): Promise<void> {
  if (isTelefonoHardBlocked(telefono)) {
    throw new Error('TELEFONO_BLOQUEADO')
  }
  const accountSid = process.env.TWILIO_ACCOUNT_SID!
  const auth = 'Basic ' + Buffer.from(`${accountSid}:${process.env.TWILIO_AUTH_TOKEN!}`).toString('base64')

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        From: `whatsapp:${fromNumber}`,
        To: `whatsapp:+${telefono}`,
        ContentSid: contentSid,
        // {{1}}=nombre  {{3}}=zona  {{4}}=rubro  (según plantilla aprobada)
        ContentVariables: JSON.stringify({ '1': nombre, '2': '5', '3': zona, '4': rubro }),
      }).toString(),
    }
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Twilio template error ${res.status}: ${err}`)
  }
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

  // 1. Verificar sender en tabla senders (activo + id para taggear conversaciones)
  const { data: senderRow } = await sup
    .from('senders')
    .select('id, activo')
    .eq('provider', provider)
    .eq('phone_number', phoneNumber)
    .maybeSingle()

  if (senderRow && !senderRow.activo) return { status: 'inactivo' }

  const senderId = senderRow?.id ?? null

  // 2. Contador diario (métrica / diagnóstico; no condiciona envíos)
  const enviados = await leerDailyCount(sup, key)

  // 3. Slot de cadencia (omitido si intMin e intMax son ≤ 0)
  if (!forced && (intMin > 0 || intMax > 0)) {
    const nextSlotStr = await leerConfig(sup, `${key}_primer_next_slot_at`, '1970-01-01T00:00:00.000Z')
    if (new Date(nextSlotStr).getTime() > Date.now()) {
      const faltanMin = Math.ceil((new Date(nextSlotStr).getTime() - Date.now()) / 60_000)
      return { status: 'slot_no_alcanzado', next_slot_at: nextSlotStr, faltan_min: faltanMin }
    }
  }

  // 4. Loop: intentar leads hasta mandar uno o agotar MAX_LEADS_POR_TICK
  const erroresTick: Array<{ lead_id: string; error: string }> = []

  for (let i = 0; i < MAX_LEADS_POR_TICK; i++) {
    // Elegir lead: el más antiguo en cola (FIFO) que no haya tomado el otro sender en este tick
    const { data: candidatos } = await sup
      .from(LEADS_TABLE)
      .select('*')
      .eq('origen', 'outbound')
      .eq('mensaje_enviado', false)
      .eq('estado', 'pendiente')
      .lt('primer_envio_intentos', MAX_REINTENTOS)
      .not('telefono', 'is', null)
      .order('created_at', { ascending: true })
      .limit(200)

    const lead = (candidatos ?? []).find(
      (l: LeadColaRow) => !yaProcesoIds.includes(l.id)
    ) as LeadColaRow | undefined

    if (!lead) {
      return {
        status: erroresTick.length > 0 ? 'error_sin_mas_candidatos' : 'sin_pendientes',
        errores: erroresTick,
      }
    }

    // Reservar para que el otro sender no lo tome en el mismo tick
    yaProcesoIds.push(lead.id)

    const telefono = normalizarTelefonoArg(String(lead.telefono))
    if (!telefono) {
      await actualizarLead(sup, lead.id, { estado: 'descartado', primer_envio_error: 'telefono_invalido' })
      continue
    }

    if (isTelefonoHardBlocked(telefono)) {
      await actualizarLead(sup, lead.id, {
        estado: 'descartado',
        primer_envio_error: 'telefono_bloqueado_lista',
        procesando_hasta: null,
      })
      console.warn(`[cron leads-pendientes] [${key}] Lead ${lead.id} — tel ${telefono} en lista de bloqueo, descartado`)
      continue
    }

    const telsMismaLinea = variantesTelefonoMismaLinea(telefono)

    // Evitar spam: saltar si el teléfono ya tiene conversación previa o fue enviado antes
    // (misma línea: 54 11 con/sin 9 móvil).
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

    if (yaConv || yaLead || yaConvPorLead) {
      await actualizarLead(sup, lead.id, {
        estado: 'contactado',
        mensaje_enviado: true,
        primer_envio_error: 'telefono_ya_contactado',
      })
      console.warn(`[cron leads-pendientes] [${key}] Lead ${lead.id} saltado — teléfono ${telefono} ya fue contactado`)
      continue
    }

    // Lock atómico: intentar reclamar el lead marcando procesando_hasta.
    // Si otro proceso ya lo reclamó (procesando_hasta en el futuro) o ya lo envió,
    // el UPDATE no matchea y devuelve count=0 — saltar sin enviar.
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

    if (claimErr || !claimed) {
      console.warn(`[cron leads-pendientes] [${key}] Lead ${lead.id} ya reclamado por otro proceso — saltando`)
      continue
    }

    try {
      await enviarTemplateTwilio(telefono, lead.nombre, lead.zona, lead.rubro, phoneNumber, contentSid)
      const mensajeGuardado = `Hola ${lead.nombre} Vi que tu negocio tiene 5⭐ en Google. Trabajo con negocios de ${lead.zona} haciendo páginas web para ${lead.rubro}. ¿Puedo contarte en 2 minutos?`

      // Guardar conversación
      await sup.from('conversaciones').insert({
        lead_id: lead.id,
        telefono,
        mensaje: mensajeGuardado,
        rol: 'agente',
        tipo_mensaje: 'texto',
        manual: false,
        sender_id: senderId,
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
        enviados_hoy: enviados + 1,
        proximo_slot_at: proximoSlot?.toISOString() ?? null,
        proximo_min: proximoMin,
        intentos_hasta_envio: i + 1,
        ...(erroresTick.length > 0 ? { saltados: erroresTick.length } : {}),
      }

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[cron leads-pendientes] [${key}] Lead ${lead.id} falló:`, msg)

      erroresTick.push({ lead_id: lead.id, error: msg })

      await actualizarLead(sup, lead.id, {
        primer_envio_intentos: (lead.primer_envio_intentos ?? 0) + 1,
        primer_envio_error: msg.slice(0, 500),
      })

      const fallosAntes = parseInt(await leerConfig(sup, `${key}_primer_fallos`, '0'), 10) || 0
      const fallos = fallosAntes + 1
      await escribirConfig(sup, `${key}_primer_fallos`, String(fallos))

      if (fallos >= 10) {
        // Pausar el sender automáticamente en la tabla senders (visible en UI)
        if (senderRow?.id) {
          await sup.from('senders').update({ activo: false }).eq('id', senderRow.id)
        }
        console.error(`[cron leads-pendientes] [${key}] 10 fallos consecutivos — sender pausado automáticamente`)
        return {
          status: 'pausado_auto',
          lead_id: lead.id,
          error: msg,
          fallos_consecutivos: fallos,
          errores_tick: erroresTick,
        }
      }

      console.warn(`[cron leads-pendientes] [${key}] Fallo ${fallos}/10 — saltando al siguiente lead...`)
      // Continúa el loop con el siguiente lead
    }
  }

  return { status: 'error_max_intentos_tick', intentos: MAX_LEADS_POR_TICK, errores: erroresTick }
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  if (!authCron(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const forced = req.nextUrl.searchParams.get('force') === 'true'
  const sup = createSupabaseServer()

  // Verificar interruptor global
  const { data: cfgActivo } = await sup
    .from('configuracion').select('valor').eq('clave', 'first_contact_activo').maybeSingle()
  if (cfgActivo?.valor !== 'true') {
    return NextResponse.json({ ok: true, skipped: 'first_contact_inactivo' })
  }

  // Ventana horaria AR: 08:00–20:59 (inclusive; sin tope de cantidad).
  const horaAr = new Date(Date.now() + TZ_OFFSET_HOURS_AR * 3600_000).getUTCHours()
  if (horaAr < HORA_INICIO_AR || horaAr > HORA_FIN_AR) {
    return NextResponse.json({
      ok: true,
      skipped: 'fuera_ventana_horaria',
      hora_ar: horaAr,
      ventana: `${String(HORA_INICIO_AR).padStart(2, '0')}:00–${String(HORA_FIN_AR).padStart(2, '0')}:59`,
    })
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
