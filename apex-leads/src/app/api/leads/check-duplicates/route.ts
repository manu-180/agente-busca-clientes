import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

export const runtime = 'nodejs'

function normalizar(t: string | null | undefined): string {
  if (!t) return ''
  return t.replace(/\D/g, '')
}

/**
 * POST /api/leads/check-duplicates
 * Body: { telefonos: string[] }
 * Resp: { existentes: string[] }
 *
 * Recibe un batch de teléfonos y devuelve cuáles ya están en `leads` o
 * `conversaciones`. Reemplaza el filtro de duplicados que antes hacía
 * `/api/leads/buscar` por cada localidad — ahora un solo POST al final
 * cubre toda la sesión de búsqueda.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const inputs = Array.isArray(body?.telefonos) ? body.telefonos : []
    const tels = Array.from(
      new Set(inputs.map((t: unknown) => normalizar(typeof t === 'string' ? t : '')).filter(Boolean))
    ) as string[]

    if (tels.length === 0) {
      return NextResponse.json({ existentes: [] })
    }

    const supabase = createSupabaseServer()
    const [{ data: leadsData, error: leadsError }, { data: convsData }] = await Promise.all([
      supabase.from('leads').select('telefono').in('telefono', tels),
      supabase.from('conversaciones').select('telefono').in('telefono', tels),
    ])

    if (leadsError) {
      return NextResponse.json(
        { error: `Error consultando leads: ${leadsError.message}` },
        { status: 500 }
      )
    }

    const existentes = Array.from(
      new Set(
        [
          ...(leadsData ?? []),
          ...(convsData ?? []),
        ]
          .map((row) => normalizar(String(row.telefono ?? '')))
          .filter(Boolean)
      )
    )

    return NextResponse.json({ existentes })
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : 'Error desconocido'
    console.error('[check-duplicates] error', mensaje)
    return NextResponse.json({ error: 'No se pudo chequear duplicados.' }, { status: 500 })
  }
}
