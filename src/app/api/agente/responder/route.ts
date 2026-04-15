import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseServer } from '@/lib/supabase-server'
import { buildAgentPrompt } from '@/lib/prompts'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { telefono, mensaje_nuevo, lead_id } = body

  const supabase = createSupabaseServer()
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Falta ANTHROPIC_API_KEY' }, { status: 500 })
  }

  // 1. Buscar el lead
  let lead
  if (lead_id) {
    const { data } = await supabase.from('leads').select('*').eq('id', lead_id).single()
    lead = data
  } else {
    const { data } = await supabase.from('leads').select('*').eq('telefono', telefono).single()
    lead = data
  }

  if (!lead) {
    return NextResponse.json({ error: 'Lead no encontrado' }, { status: 404 })
  }

  // 2. Verificar si el agente está activo para este lead
  if (!lead.agente_activo) {
    return NextResponse.json({ respuesta: null, motivo: 'agente_inactivo' })
  }

  // 3. Verificar agente global
  const { data: configAgente } = await supabase
    .from('configuracion')
    .select('valor')
    .eq('clave', 'agente_activo')
    .single()

  if (configAgente?.valor !== 'true') {
    return NextResponse.json({ respuesta: null, motivo: 'agente_global_inactivo' })
  }

  // 4. Traer info de APEX
  const { data: apexInfo } = await supabase
    .from('apex_info')
    .select('categoria, titulo, contenido')
    .eq('activo', true)

  const apexInfoTexto = (apexInfo ?? [])
    .map(info => `[${info.categoria.toUpperCase()}] ${info.titulo}\n${info.contenido}`)
    .join('\n\n')

  // 5. Traer historial
  const { data: historial } = await supabase
    .from('conversaciones')
    .select('rol, mensaje, timestamp')
    .eq('lead_id', lead.id)
    .order('timestamp', { ascending: true })
    .limit(20)

  const historialTexto = (historial ?? [])
    .map(h => `[${h.rol === 'agente' ? 'APEX' : 'CLIENTE'}] ${h.mensaje}`)
    .join('\n')

  // 6. Construir prompt según origen
  const systemPrompt = buildAgentPrompt(
    lead.origen as 'outbound' | 'inbound',
    apexInfoTexto,
    historialTexto
  )

  // 7. Llamar a Claude
  const client = new Anthropic({ apiKey })
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 300,
    system: systemPrompt,
    messages: [{ role: 'user', content: mensaje_nuevo }],
  })

  const respuesta = response.content[0].type === 'text' ? response.content[0].text : ''

  return NextResponse.json({ respuesta: respuesta.trim() })
}
