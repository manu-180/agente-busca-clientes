import { NextResponse } from 'next/server'
import { getKeysStatusForUi } from '@/lib/google-places/quota'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/leads/places-keys
 *
 * Devuelve el estado mensual de cada API key de Google Places configurada.
 * Pensado para alimentar el panel "API keys de Google Places" en el dashboard
 * de Nuevos Leads. NO devuelve el valor de la key — solo el sufijo (4 chars).
 */
export async function GET() {
  try {
    const status = await getKeysStatusForUi()
    return NextResponse.json(status, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : 'Error desconocido'
    console.error('[places-keys] error', mensaje)
    return NextResponse.json({ error: 'No se pudo leer el estado de las keys.' }, { status: 500 })
  }
}
