import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import {
  PlacesAllKeysExhaustedError,
  PlacesNoKeysError,
  searchPlaces,
} from '@/lib/google-places/search'

export const maxDuration = 30
export const runtime = 'nodejs'

function normalizarTelefono(telefono: string | null | undefined): string {
  if (!telefono) return ''
  return telefono.replace(/\D/g, '')
}

async function obtenerTelefonosExistentes(telefonos: string[]) {
  const supabase = createSupabaseServer()

  const { data: leadsData, error: leadsError } = await supabase
    .from('leads')
    .select('telefono')
    .in('telefono', telefonos)

  if (leadsError) {
    return { error: `Error consultando leads: ${leadsError.message}` }
  }

  const { data: convsData } = await supabase
    .from('conversaciones')
    .select('telefono')
    .in('telefono', telefonos)

  const todos = [...(leadsData ?? []), ...(convsData ?? [])]

  return {
    telefonos: todos.map((e) => normalizarTelefono(String(e.telefono ?? ''))).filter(Boolean),
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const rubro = typeof body?.rubro === 'string' ? body.rubro.trim() : ''
    const zona =
      typeof body?.zona === 'string' && body.zona.trim() ? body.zona.trim() : 'Buenos Aires'

    if (!rubro) {
      return NextResponse.json({ error: 'El rubro es obligatorio.' }, { status: 400 })
    }

    let searchOut
    try {
      searchOut = await searchPlaces(rubro, zona)
    } catch (err) {
      if (err instanceof PlacesNoKeysError) {
        return NextResponse.json(
          { error: 'No hay GOOGLE_PLACES_API_KEY configurada en el servidor.' },
          { status: 500 },
        )
      }
      if (err instanceof PlacesAllKeysExhaustedError) {
        return NextResponse.json(
          {
            error: 'Todas las API keys de Google Places agotaron su cuota gratuita mensual. Esperá al primer día del mes (hora del Pacífico) o sumá otra clave en una env var GOOGLE_PLACES_API_KEY_N.',
            quota_exhausted: true,
          },
          { status: 429 },
        )
      }
      const mensaje = err instanceof Error ? err.message : 'Error desconocido'
      console.error('[buscar] Google Places falló', { rubro, zona, mensaje })
      return NextResponse.json(
        { error: `No se pudo buscar en Google Places: ${mensaje}` },
        { status: 502 },
      )
    }

    const candidatos = searchOut.resultados
    const telefonos = Array.from(new Set(candidatos.map((p) => p.telefono).filter(Boolean)))
    let telefonosExistentes = new Set<string>()

    if (telefonos.length > 0) {
      const existentes = await obtenerTelefonosExistentes(telefonos)
      if (existentes.error) {
        return NextResponse.json({ error: existentes.error }, { status: 500 })
      }
      telefonosExistentes = new Set(existentes.telefonos)
    }

    const resultados = candidatos
      .map((item) => ({
        ...item,
        ya_registrado: item.telefono ? telefonosExistentes.has(item.telefono) : false,
      }))
      .filter((item) => !item.ya_registrado)

    return NextResponse.json({
      resultados,
      key_label: searchOut.key_label,
      key_used: searchOut.used,
      key_quota: searchOut.quota,
    })
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : 'Error desconocido'
    console.error('[buscar] Error inesperado', mensaje)
    return NextResponse.json({ error: 'No se pudo buscar negocios.' }, { status: 500 })
  }
}
