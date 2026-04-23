import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_CHAT_MODEL } from '@/lib/anthropic-model'
import { buildAgentPrompt } from '@/lib/prompts'
import { detectarVertical, sanitizarApexInfoPorVertical } from '@/lib/verticales'

export async function POST(request: Request) {
  const { lead_id } = await request.json()

  if (!lead_id) return NextResponse.json({ error: 'lead_id requerido' }, { status: 400 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY no configurada' }, { status: 500 })

  const supabase = createSupabaseServer()

  const { data: lead } = await supabase.from('leads').select('*').eq('id', lead_id).single()
  if (!lead) return NextResponse.json({ error: 'Lead no encontrado' }, { status: 404 })

  const { data: apexInfo } = await supabase
    .from('apex_info')
    .select('categoria, titulo, contenido')
    .eq('activo', true)

  const apexInfoTextoRaw = (apexInfo ?? [])
    .map(info => `[${info.categoria.toUpperCase()}] ${info.titulo}\n${info.contenido}`)
    .join('\n\n')

  const verticalLead = detectarVertical(String(lead.rubro ?? ''), lead.descripcion as string | null)
  const apexInfoTexto = sanitizarApexInfoPorVertical(apexInfoTextoRaw, verticalLead).texto

  const { data: historial } = await supabase
    .from('conversaciones')
    .select('rol, mensaje, timestamp')
    .eq('lead_id', lead_id)
    .order('timestamp', { ascending: true })
    .limit(20)

  const historialTexto = (historial ?? [])
    .map(h => `[${h.rol === 'agente' ? 'APEX' : 'CLIENTE'}] ${h.mensaje}`)
    .join('\n')

  const contextoLead = {
    nombre: String(lead.nombre ?? ''),
    rubro: String(lead.rubro ?? ''),
    zona: String(lead.zona ?? ''),
    descripcion: lead.descripcion as string | null | undefined,
    mensajeInicial: lead.mensaje_inicial as string | null | undefined,
  }

  const systemPrompt = buildAgentPrompt(
    lead.origen as 'outbound' | 'inbound',
    apexInfoTexto,
    historialTexto,
    contextoLead
  )

  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: ANTHROPIC_CHAT_MODEL,
      max_tokens: 300,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: 'Sugerí un mensaje corto para que el dueño del negocio envíe manualmente. Debe ser natural, coherente con la conversación, y seguir la misma lógica de ventas. Solo devolvé el mensaje, sin explicaciones ni comillas.',
      }],
    })

    const sugerencia = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
    return NextResponse.json({ sugerencia })
  } catch (error: any) {
    console.error('[SUGERIR] Error:', error.message)
    return NextResponse.json({ error: 'Error generando sugerencia' }, { status: 500 })
  }
}
