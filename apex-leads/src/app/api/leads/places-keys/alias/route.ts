import { NextRequest, NextResponse } from 'next/server'
import { setAlias } from '@/lib/google-places/quota'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_ALIAS_LEN = 60

/**
 * POST /api/leads/places-keys/alias
 * Body: { label: string, alias: string | null }
 *
 * Guarda (o borra, si alias es vacío/null) el alias humano de una API key.
 * Solo aceptamos labels con el formato canónico GOOGLE_PLACES_API_KEY[_N]
 * para no permitir escribir en filas arbitrarias.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { label?: unknown; alias?: unknown }
    const label = typeof body?.label === 'string' ? body.label.trim() : ''
    if (!label) {
      return NextResponse.json({ error: 'label requerido.' }, { status: 400 })
    }
    const valid = label === 'GOOGLE_PLACES_API_KEY' || /^GOOGLE_PLACES_API_KEY_\d+$/.test(label)
    if (!valid) {
      return NextResponse.json({ error: 'label con formato inválido.' }, { status: 400 })
    }

    const rawAlias = typeof body?.alias === 'string' ? body.alias : ''
    const trimmed = rawAlias.trim()
    if (trimmed.length > MAX_ALIAS_LEN) {
      return NextResponse.json(
        { error: `alias supera ${MAX_ALIAS_LEN} chars.` },
        { status: 400 },
      )
    }

    const ok = await setAlias(label, trimmed.length > 0 ? trimmed : null)
    if (!ok) {
      return NextResponse.json({ error: 'No se pudo guardar el alias.' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, label, alias: trimmed.length > 0 ? trimmed : null })
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : 'Error desconocido'
    console.error('[places-keys/alias] error', mensaje)
    return NextResponse.json({ error: 'No se pudo guardar el alias.' }, { status: 500 })
  }
}
