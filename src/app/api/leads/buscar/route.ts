import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

interface GooglePlace {
  displayName?: { text?: string }
  formattedAddress?: string
  nationalPhoneNumber?: string
  internationalPhoneNumber?: string
  websiteUri?: string
  rating?: number
  userRatingCount?: number
  googleMapsUri?: string
}

function normalizarTelefono(telefono: string | null | undefined): string {
  if (!telefono) return ''
  return telefono.replace(/\D/g, '')
}

async function obtenerTelefonosExistentes(telefonos: string[]) {
  const supabase = createSupabaseServer()
  const tablas = ['leads', 'leads_apex_next']

  for (const tabla of tablas) {
    const { data, error } = await supabase.from(tabla).select('telefono').in('telefono', telefonos)

    if (!error) {
      return { telefonos: (data || []).map((item) => normalizarTelefono(item.telefono)).filter(Boolean) }
    }

    const tablaNoExiste = error.message.includes("Could not find the table 'public.leads'")
    if (!tablaNoExiste) {
      return { error: `Error consultando leads: ${error.message}` }
    }
  }

  return { error: 'No existe la tabla de leads esperada en Supabase.' }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const rubro = typeof body?.rubro === 'string' ? body.rubro.trim() : ''
    const zona = typeof body?.zona === 'string' && body.zona.trim() ? body.zona.trim() : 'Buenos Aires'

    if (!rubro) {
      return NextResponse.json({ error: 'El rubro es obligatorio.' }, { status: 400 })
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'Falta GOOGLE_PLACES_API_KEY.' }, { status: 500 })
    }

    const googleResponse = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.googleMapsUri,places.types',
      },
      body: JSON.stringify({
        textQuery: `${rubro} en ${zona}`,
        languageCode: 'es',
        maxResultCount: 20,
      }),
      cache: 'no-store',
    })

    if (!googleResponse.ok) {
      const errorText = await googleResponse.text()
      return NextResponse.json(
        { error: `Google Places devolvió ${googleResponse.status}: ${errorText}` },
        { status: 502 }
      )
    }

    const googleData = await googleResponse.json()
    const places: GooglePlace[] = Array.isArray(googleData?.places) ? googleData.places : []

    const preliminares = places.map((place) => {
      const telefonoRaw = place.internationalPhoneNumber || place.nationalPhoneNumber || ''
      const telefono = normalizarTelefono(telefonoRaw)
      const urlWeb = place.websiteUri?.trim() || null
      const tieneWeb = Boolean(urlWeb)

      return {
        nombre: place.displayName?.text || 'Negocio sin nombre',
        direccion: place.formattedAddress || '',
        telefono,
        rating: typeof place.rating === 'number' ? place.rating : 0,
        cantidad_reviews: typeof place.userRatingCount === 'number' ? place.userRatingCount : 0,
        tiene_web: tieneWeb,
        url_web: urlWeb,
        google_maps_url: place.googleMapsUri || '',
        ya_registrado: false,
        rubro,
      }
    })
    const candidatosFiltrados = preliminares.filter(
      (item) => Boolean(item.telefono) && !item.tiene_web
    )

    const telefonos = Array.from(
      new Set(candidatosFiltrados.map((p) => p.telefono).filter(Boolean))
    )
    let telefonosExistentes = new Set<string>()

    if (telefonos.length > 0) {
      const existentes = await obtenerTelefonosExistentes(telefonos)
      if (existentes.error) {
        return NextResponse.json({ error: existentes.error }, { status: 500 })
      }

      telefonosExistentes = new Set(existentes.telefonos)
    }

    const resultados = candidatosFiltrados.map((item) => ({
      ...item,
      ya_registrado: item.telefono ? telefonosExistentes.has(item.telefono) : false,
    }))

    return NextResponse.json({ resultados })
  } catch {
    return NextResponse.json({ error: 'No se pudo buscar negocios.' }, { status: 500 })
  }
}
