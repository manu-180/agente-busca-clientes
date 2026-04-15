import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { enviarMensajeWassenger } from '@/lib/wassenger'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { telefono, mensaje, lead_id, manual } = body

  if (!telefono || !mensaje) {
    return NextResponse.json({ error: 'Faltan telefono o mensaje' }, { status: 400 })
  }

  const supabase = createSupabaseServer()

  // Buscar lead si no tenemos el id
  let leadId = lead_id
  if (!leadId) {
    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('telefono', telefono)
      .single()
    leadId = lead?.id
  }

  try {
    // Enviar por Wassenger
    await enviarMensajeWassenger(telefono, mensaje)

    // Guardar en conversaciones
    if (leadId) {
      await supabase.from('conversaciones').insert({
        lead_id: leadId,
        telefono,
        mensaje,
        rol: 'agente',
        tipo_mensaje: 'texto',
      })
    }

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('Error enviando mensaje:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
