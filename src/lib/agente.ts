import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseServer } from '@/lib/supabase-server'
import { buildAgentPrompt } from '@/lib/prompts'
import { enviarMensajeWassenger } from '@/lib/wassenger'

export async function generarRespuestaAgente({
  telefono,
  mensaje_nuevo,
  lead_id,
}: {
  telefono: string
  mensaje_nuevo: string
  lead_id: string
}): Promise<{ respuesta: string | null }> {
  console.log('[AGENTE] Generando respuesta para lead:', lead_id, 'teléfono:', telefono)

  const supabase = createSupabaseServer()
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    console.error('[AGENTE] Error: ANTHROPIC_API_KEY no configurada')
    return { respuesta: null }
  }

  try {
    // 1. Buscar el lead
    console.log('[AGENTE] Buscando lead...')
    let lead
    if (lead_id) {
      const { data } = await supabase.from('leads').select('*').eq('id', lead_id).single()
      lead = data
    } else {
      const { data } = await supabase.from('leads').select('*').eq('telefono', telefono).single()
      lead = data
    }

    if (!lead) {
      console.warn('[AGENTE] Lead no encontrado:', lead_id || telefono)
      return { respuesta: null }
    }

    // 2. Verificar si el agente está activo para este lead
    if (!lead.agente_activo) {
      console.log('[AGENTE] Agente inactivo para este lead')
      return { respuesta: null }
    }

    // 3. Verificar agente global
    console.log('[AGENTE] Verificando estado global del agente...')
    const { data: configAgente } = await supabase
      .from('configuracion')
      .select('valor')
      .eq('clave', 'agente_activo')
      .single()

    if (configAgente?.valor !== 'true') {
      console.log('[AGENTE] Agente global desactivado')
      return { respuesta: null }
    }

    // 4. Traer info de APEX
    console.log('[AGENTE] Cargando información de APEX...')
    const { data: apexInfo } = await supabase
      .from('apex_info')
      .select('categoria, titulo, contenido')
      .eq('activo', true)

    const apexInfoTexto = (apexInfo ?? [])
      .map(info => `[${info.categoria.toUpperCase()}] ${info.titulo}\n${info.contenido}`)
      .join('\n\n')

    // 5. Traer historial
    console.log('[AGENTE] Cargando historial de conversación...')
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
    console.log('[AGENTE] Construyendo prompt del sistema...')
    const systemPrompt = buildAgentPrompt(
      lead.origen as 'outbound' | 'inbound',
      apexInfoTexto,
      historialTexto
    )

    // 7. Llamar a Claude
    console.log('[AGENTE] Llamando a Claude Sonnet...')
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: mensaje_nuevo }],
    })

    const respuesta = response.content[0].type === 'text' ? response.content[0].text : ''
    console.log('[AGENTE] Respuesta generada exitosamente')

    return { respuesta: respuesta.trim() }
  } catch (error: any) {
    console.error('[AGENTE] Error generando respuesta:', error.message)
    return { respuesta: null }
  }
}

export async function enviarMensajeAgente({
  telefono,
  mensaje,
  lead_id,
}: {
  telefono: string
  mensaje: string
  lead_id: string
}): Promise<{ ok: boolean; error?: string }> {
  console.log('[AGENTE] Enviando mensaje a:', telefono, 'lead:', lead_id)

  if (!telefono || !mensaje) {
    console.error('[AGENTE] Faltan parámetros: teléfono o mensaje')
    return { ok: false, error: 'Faltan telefono o mensaje' }
  }

  const supabase = createSupabaseServer()

  try {
    // Enviar por Wassenger
    console.log('[AGENTE] Enviando por Wassenger...')
    await enviarMensajeWassenger(telefono, mensaje)

    // Guardar en conversaciones
    if (lead_id) {
      console.log('[AGENTE] Guardando en base de datos...')
      await supabase.from('conversaciones').insert({
        lead_id,
        telefono,
        mensaje,
        rol: 'agente',
        tipo_mensaje: 'texto',
      })
    }

    console.log('[AGENTE] Mensaje enviado exitosamente')
    return { ok: true }
  } catch (error: any) {
    console.error('[AGENTE] Error enviando mensaje:', error.message)
    return { ok: false, error: error.message }
  }
}
