import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { listDemos } from '@/lib/demos-repo'
import { matchDemoFromTexts } from '@/lib/demo-match'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { nombre, rubro, zona, descripcion, instagram } = body

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'Falta ANTHROPIC_API_KEY' }, { status: 500 })
    }

    const demos = await listDemos()
    const match = matchDemoFromTexts(demos, {
      rubroGuardado: rubro,
      textos: [descripcion || '', nombre || '', rubro || ''],
    })

    const demoDisponible = match.demo
      ? `Demo disponible para este rubro: ${match.demo.rubro_label} — ${match.demo.url}`
      : 'Demo disponible: ninguna (sin match fuerte)'

    const client = new Anthropic({ apiKey })

    const contextoParts = [
      `Negocio: ${nombre}`,
      `Rubro: ${rubro}`,
      `Zona: ${zona || 'Buenos Aires'}`,
      descripcion ? `Contexto: ${descripcion}` : '',
      instagram ? `Instagram: ${instagram}` : '',
      demoDisponible,
    ]
      .filter(Boolean)
      .join('\n')

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: `Sos quien redacta el primer contacto de WhatsApp para APEX (desarrollo web/apps, Buenos Aires).
Generá UN solo mensaje para este negocio: tono semiformal rioplatense (vos), breve y humano.

REGLAS (alineadas al asistente APEX):
- Entre 80 y 350 caracteres. Nunca más de 420. Como WhatsApp real, no email.
- No uses emojis en este primer mensaje.
- Podés usar *negrita* de WhatsApp solo para 1-2 palabras clave (ej. *APEX*, *boceto gratis*).
- Mencioná algo ESPECÍFICO del negocio (rubro, zona, lo que venga en el contexto).
- Si el contexto indica que hay una demo disponible para el rubro, incluí UNA frase corta mencionando esa demo y su URL, de forma natural.
- Siempre agregá una frase breve invitando a visitar www.theapexweb.com para ver más trabajos o conocer mejor a APEX (no reemplaza la demo; va como complemento).
- Ofrecé un boceto gratuito de cómo podría verse su web, sin ser agresivo.
- Devolvé SOLO el texto del mensaje, sin comillas ni explicaciones.`,
      messages: [
        {
          role: 'user',
          content: `Generá el mensaje de WhatsApp para este negocio.\n\nContexto:\n${contextoParts}`,
        },
      ],
    })

    const mensaje = response.content[0].type === 'text' ? response.content[0].text : ''
    return NextResponse.json({ mensaje: mensaje.trim() })
  } catch {
    return NextResponse.json({ error: 'No se pudo generar el mensaje.' }, { status: 500 })
  }
}
