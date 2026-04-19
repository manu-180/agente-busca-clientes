import { NextRequest, NextResponse } from 'next/server'
import { generarPrimerMensaje } from '@/lib/generar-primer-mensaje'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { nombre, rubro, zona, descripcion, instagram } = body

    const mensaje = await generarPrimerMensaje({
      nombre,
      rubro,
      zona,
      descripcion,
      instagram,
    })

    if (!mensaje) {
      return NextResponse.json({ error: 'No se pudo generar el mensaje.' }, { status: 500 })
    }

    return NextResponse.json({ mensaje })
  } catch {
    return NextResponse.json({ error: 'No se pudo generar el mensaje.' }, { status: 500 })
  }
}
