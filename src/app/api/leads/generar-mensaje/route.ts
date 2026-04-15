import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { nombre, rubro, zona, descripcion, instagram } = body

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'Falta ANTHROPIC_API_KEY' }, { status: 500 })
    }

    const client = new Anthropic({ apiKey })

    const contextoParts = [
      `Negocio: ${nombre}`,
      `Rubro: ${rubro}`,
      `Zona: ${zona || 'Buenos Aires'}`,
      descripcion ? `Contexto: ${descripcion}` : '',
      instagram ? `Instagram: ${instagram}` : '',
    ]
      .filter(Boolean)
      .join('\n')

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: `Sos un experto en ventas de APEX, una agencia de desarrollo web en Argentina.
Generá UN mensaje corto para enviar por WhatsApp a este negocio ofreciendo tus servicios.

REGLAS:
- Máximo 4 líneas. Como un WhatsApp real, no un email.
- Mencioná algo ESPECÍFICO del negocio (rubro, zona, lo que tengas).
- No seas vendedor pesado. Sé casual y directo.
- Ofrecé un boceto gratuito de cómo quedaría su página web.
- Usá español rioplatense (vos, tenés, mirá).
- NO uses emojis.
- NO uses asteriscos ni markdown.
- Devolvé SOLO el mensaje, sin explicaciones ni comillas.`,
      messages: [
        {
          role: 'user',
          content: `Generá el mensaje de WhatsApp para este negocio:\n\n${contextoParts}`,
        },
      ],
    })

    const mensaje = response.content[0].type === 'text' ? response.content[0].text : ''
    return NextResponse.json({ mensaje: mensaje.trim() })
  } catch {
    return NextResponse.json({ error: 'No se pudo generar el mensaje.' }, { status: 500 })
  }
}
