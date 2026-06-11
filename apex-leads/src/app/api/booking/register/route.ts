// Puente de reservas desde theapexweb.com (APEX_next).
//
// APEX_next NO habla con Evolution directo: este endpoint es el único dueño
// de las credenciales y del estado de los senders. Hace tres cosas:
// 1. Crea (o encuentra) el lead y registra la conversación → la reserva
//    aparece en el inbox aunque el cliente nunca conteste.
// 2. Envía la confirmación al cliente con el sender principal de APEX.
// 3. Notifica al admin (self-message al mismo número).
//
// El envío es best-effort: si Evolution está caído igual registramos el lead
// y devolvemos ok — la reserva ya existe en la web y el inbox la muestra.

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { enviarMensajeEvolution, isEvolutionError } from '@/lib/evolution'
import { normalizarTelefonoArg, variantesTelefonoMismaLinea, claveUnicaPaisLinea } from '@/lib/phone'
import { cargarProyectoApexDefault } from '@/lib/projects'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Número público de APEX — el sender desde el que deben salir las confirmaciones. */
const APEX_MAIN_PHONE = '5491168049457'

function authBridge(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

type SenderRow = {
  id: string
  alias: string | null
  instance_name: string
  phone_number: string
  connected: boolean
  activo: boolean
}

/** Sender principal (número público). Fallback: cualquier sender activo+conectado. */
async function elegirSenderParaBooking(
  supabase: ReturnType<typeof createSupabaseServer>
): Promise<SenderRow | null> {
  const { data } = await supabase
    .from('senders')
    .select('id, alias, instance_name, phone_number, connected, activo')
    .eq('provider', 'evolution')
    .eq('activo', true)
  const senders = (data ?? []) as SenderRow[]
  if (senders.length === 0) return null

  const claveMain = claveUnicaPaisLinea(APEX_MAIN_PHONE)
  const main = senders.find(s => claveUnicaPaisLinea(s.phone_number ?? '') === claveMain)
  if (main?.connected) return main
  return senders.find(s => s.connected) ?? main ?? senders[0]
}

export async function POST(req: NextRequest) {
  if (!authBridge(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { phone?: string; clientName?: string; dateIso?: string; hour?: number; source?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const phoneRaw = typeof body.phone === 'string' ? body.phone : ''
  const dateIso = typeof body.dateIso === 'string' ? body.dateIso : ''
  const hour = typeof body.hour === 'number' ? body.hour : NaN
  const clientName =
    typeof body.clientName === 'string' && body.clientName.trim().length > 0
      ? body.clientName.trim()
      : 'Cliente'

  const telefono = normalizarTelefonoArg(phoneRaw)
  if (!telefono || telefono.length < 10 || !dateIso || Number.isNaN(hour) || hour < 0 || hour > 23) {
    return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
  }

  const supabase = createSupabaseServer()

  // ── Lead: buscar por variantes de la misma línea o crear ──
  const variantes = variantesTelefonoMismaLinea(telefono)
  const { data: candidatos } = await supabase
    .from('leads')
    .select('id, telefono, estado, origen, sender_id, mensaje_enviado, created_at')
    .in('telefono', variantes)

  let lead = candidatos?.length
    ? [...candidatos].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )[0]
    : null

  if (!lead) {
    const project = await cargarProyectoApexDefault(supabase)
    if (!project) {
      return NextResponse.json({ error: 'Proyecto APEX no configurado' }, { status: 500 })
    }
    const { data: nuevo, error: insertErr } = await supabase
      .from('leads')
      .insert({
        project_id: project.id,
        nombre: clientName !== 'Cliente' ? clientName : `Lead ${telefono.slice(-4)}`,
        rubro: 'Por definir',
        zona: 'Por definir',
        telefono,
        descripcion: `Reservó una reunión desde theapexweb.com (${body.source ?? 'web'})`,
        mensaje_inicial: '',
        estado: 'contactado',
        origen: 'inbound',
        agente_activo: true,
      })
      .select('id, telefono, estado, origen, sender_id, mensaje_enviado, created_at')
      .single()
    if (insertErr || !nuevo) {
      console.error('[booking/register] insert lead falló:', insertErr?.message)
      return NextResponse.json({ error: 'No se pudo registrar el lead' }, { status: 500 })
    }
    lead = nuevo
  }

  // ── Textos ──
  const fechaStr = new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date(dateIso))
  const horaStr = `${hour}:00 hs`

  const textCliente = `¡Hola ${clientName}! Tu reunión con APEX quedó agendada para el ${fechaStr} a las ${horaStr}. Nos contactamos por este medio. ¡Saludos!`
  const textAdmin = `*Nueva reserva desde la web*\n\nCliente: ${clientName}\nTeléfono: +${telefono}\nFecha: ${fechaStr}\nHora: ${horaStr}`

  // ── Envíos best-effort ──
  const sender = await elegirSenderParaBooking(supabase)
  let sentClient = false
  let sentAdmin = false
  let messageId: string | null = null

  if (sender) {
    try {
      const res = await enviarMensajeEvolution(telefono, textCliente, sender.instance_name)
      messageId = res.messageId
      sentClient = true
    } catch (err) {
      const code = isEvolutionError(err) ? err.code : 'UNKNOWN'
      console.error(`[booking/register] envío a cliente falló (${code}):`, (err as Error).message)
    }

    try {
      // phone_number puede ser '_pending_' u otro placeholder → fallback al número principal.
      const senderDigits = normalizarTelefonoArg(sender.phone_number ?? '')
      const adminPhone = senderDigits.length >= 10 ? senderDigits : normalizarTelefonoArg(APEX_MAIN_PHONE)
      await enviarMensajeEvolution(adminPhone, textAdmin, sender.instance_name, {
        skipBlockCheck: true,
      })
      sentAdmin = true
    } catch (err) {
      const code = isEvolutionError(err) ? err.code : 'UNKNOWN'
      console.error(`[booking/register] aviso a admin falló (${code}):`, (err as Error).message)
    }
  } else {
    console.error('[booking/register] sin sender Evolution disponible — solo se registra el lead')
  }

  // ── Conversación en el inbox (siempre, se haya enviado o no) ──
  const { error: convErr } = await supabase.from('conversaciones').insert({
    lead_id: lead.id,
    telefono: lead.telefono,
    mensaje: sentClient
      ? textCliente
      : `[RESERVA WEB — WhatsApp pendiente de envío] ${textCliente}`,
    rol: 'agente',
    tipo_mensaje: 'texto',
    leido: true,
    sender_id: sender?.id ?? lead.sender_id ?? null,
    media_url: null,
    twilio_message_sid: messageId,
  })
  if (convErr) {
    console.error('[booking/register] insert conversación falló:', convErr.message)
  }

  // Anclar sender + estado coherente sin pisar estados avanzados.
  const updates: Record<string, unknown> = {}
  if (sender && !lead.sender_id) updates.sender_id = sender.id
  if (lead.estado === 'pendiente') updates.estado = 'contactado'
  if (Object.keys(updates).length > 0) {
    await supabase.from('leads').update(updates).eq('id', lead.id)
  }

  return NextResponse.json({
    ok: true,
    lead_id: lead.id,
    sent_client: sentClient,
    sent_admin: sentAdmin,
  })
}
