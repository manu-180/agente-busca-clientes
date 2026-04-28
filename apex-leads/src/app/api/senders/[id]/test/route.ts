import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { enviarMensajeEvolution } from '@/lib/evolution'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServer()
  const { telefono_test } = await req.json()

  if (!telefono_test) {
    return NextResponse.json({ error: 'telefono_test requerido' }, { status: 400 })
  }

  const { data: sender } = await supabase
    .from('senders')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!sender) return NextResponse.json({ error: 'Sender no encontrado' }, { status: 404 })

  const instanceName = sender.instance_name as string | undefined
  if (!instanceName) {
    return NextResponse.json({ error: 'Sender sin instance_name — configurar Evolution API' }, { status: 400 })
  }

  try {
    await enviarMensajeEvolution(telefono_test, 'Test de conexion APEX Lead Engine', instanceName)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
