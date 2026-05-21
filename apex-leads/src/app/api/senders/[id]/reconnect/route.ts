import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import {
  buildWebhookUrl,
  connectInstance,
  createInstance,
  deleteInstance,
  logoutInstance,
} from '@/lib/evolution-instance'

export const dynamic = 'force-dynamic'

// Reconectar = forzar QR fresh.
//
// El flujo viejo (logout + connect) NO forzaba QR: si Evolution tenía los creds
// de Baileys cacheados en disco, connectInstance arrancaba un nuevo proceso que
// cargaba esos creds y se auto-autenticaba con WhatsApp sin pedirle QR a
// Manuel. Resultado: el sender se "reconectaba solo" sin que él pudiera escanear.
//
// El flujo nuevo (logout + delete + create + connect) garantiza que las creds
// en disco quedan borradas antes de pedir QR. La instance_name se mantiene, así
// que ninguna FK (conversaciones.sender_id, leads.sender_id) se rompe.
//
// Pasos:
//   1. logoutInstance(name) — best-effort. Si el socket WA estaba abierto,
//      desvincula el dispositivo del celular. Si ya estaba caído, esto falla
//      silenciosamente (ya tenemos catch).
//   2. deleteInstance(name) — nukea la fila de Evolution y borra los creds de
//      Baileys en disco. Idempotente: si la instance no existe (404), sigue.
//   3. createInstance(name, webhook) — recrea la instance con el mismo
//      instance_name y la URL del webhook que ya estaba registrada.
//   4. connectInstance(name) — devuelve el QR fresh. Como las creds están
//      nukeadas, Baileys arranca de cero y emite QR.
//
// Side-effect en DB: marcamos connected=false, disconnection_reason=
// 'manual_reconnect_qr_requested' y refrescamos disconnected_at. Esa razón
// está en REASONS_REQUIRING_QR del cron health-evolution, así que el cron NO
// va a hacer auto-restart durante el QR scan.

const STEP_DELAY_MS = 800

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServer()
  const { data: sender, error } = await supabase
    .from('senders')
    .select('id, instance_name, provider')
    .eq('id', params.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!sender) return NextResponse.json({ error: 'sender no encontrado' }, { status: 404 })
  if (sender.provider !== 'evolution' || !sender.instance_name) {
    return NextResponse.json({ error: 'sender no es evolution o sin instance_name' }, { status: 400 })
  }

  const name = sender.instance_name

  try {
    // 1. Logout — best-effort. Desvincula del cel si el socket sigue abierto.
    try {
      await logoutInstance(name)
    } catch (err) {
      console.warn(`[reconnect ${name}] logout fallo (ignorado):`, err)
    }
    await sleep(STEP_DELAY_MS)

    // 2. Delete instance — nukea creds en disco. Si ya no existe, 404 silencioso.
    try {
      await deleteInstance(name)
    } catch (err) {
      console.warn(`[reconnect ${name}] delete fallo (ignorado):`, err)
    }
    await sleep(STEP_DELAY_MS)

    // 3. Recrear instance con mismo nombre y webhook.
    try {
      await createInstance(name, buildWebhookUrl())
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[reconnect ${name}] createInstance falló:`, msg)
      return NextResponse.json(
        { error: `No se pudo recrear la instancia: ${msg}` },
        { status: 502 }
      )
    }
    await sleep(STEP_DELAY_MS)

    // 4. Pedir QR fresh. Con creds nukeadas, Baileys emite QR sin auto-auth.
    const qr = await connectInstance(name)

    // Marcar como pendiente de QR. Razón en REASONS_REQUIRING_QR del cron
    // health-evolution → no auto-restart durante el scan.
    await supabase
      .from('senders')
      .update({
        connected: false,
        disconnected_at: new Date().toISOString(),
        disconnection_reason: 'manual_reconnect_qr_requested',
        consecutive_send_failures: 0,
        qr_requested_at: new Date().toISOString(),
      })
      .eq('id', sender.id)

    return NextResponse.json({ base64: qr.base64, code: qr.code })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[/api/senders/:id/reconnect ${name}] error`, msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
