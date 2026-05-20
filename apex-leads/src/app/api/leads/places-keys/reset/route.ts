import { NextRequest, NextResponse } from 'next/server'
import { resetKeyForMonth } from '@/lib/google-places/quota'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/leads/places-keys/reset
 * Body: { label: string }
 *
 * Re-habilita una key marcada como agotada para el mes actual. Pensado para
 * los casos en que la key salió como "agotada" por errores 403 (billing /
 * restricciones) y no por consumo real — el usuario corrige la config en
 * Google Cloud y desde la UI pulsa "Re-habilitar".
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { label?: unknown }
    const label = typeof body?.label === 'string' ? body.label.trim() : ''
    if (!label) {
      return NextResponse.json({ error: 'label requerido.' }, { status: 400 })
    }
    // Validamos formato para evitar que pasen labels arbitrarios.
    const valid = label === 'GOOGLE_PLACES_API_KEY' || /^GOOGLE_PLACES_API_KEY_\d+$/.test(label)
    if (!valid) {
      return NextResponse.json({ error: 'label con formato inválido.' }, { status: 400 })
    }
    const ok = await resetKeyForMonth(label)
    if (!ok) {
      return NextResponse.json(
        { error: 'La key no está configurada en el servidor o falló la operación.' },
        { status: 404 },
      )
    }
    return NextResponse.json({ ok: true, label })
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : 'Error desconocido'
    console.error('[places-keys/reset] error', mensaje)
    return NextResponse.json({ error: 'No se pudo re-habilitar la key.' }, { status: 500 })
  }
}
