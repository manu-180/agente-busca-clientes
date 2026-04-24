import { NextRequest, NextResponse } from 'next/server'
import { generarRespuestaAgente } from '@/lib/agente'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { telefono, mensaje_nuevo, lead_id } = body

  try {
    const result = await generarRespuestaAgente({
      telefono,
      mensaje_nuevo,
      lead_id,
    })
    return NextResponse.json(result)
  } catch (error: any) {
    console.error('[API] Error en responder:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
