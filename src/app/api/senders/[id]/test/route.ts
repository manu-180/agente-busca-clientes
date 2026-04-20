import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { enviarMensajeTwilio } from '@/lib/twilio'
import { enviarMensajeWassenger } from '@/lib/wassenger'

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

  try {
    if (sender.provider === 'twilio') {
      await enviarMensajeTwilio(telefono_test, '✅ Test de conexión APEX Lead Engine', sender.phone_number)
    } else {
      await enviarMensajeWassenger(telefono_test, '✅ Test de conexión APEX Lead Engine')
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
