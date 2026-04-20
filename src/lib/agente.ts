import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseServer } from '@/lib/supabase-server'
import { buildAgentPrompt, buildUserMessageWithLeadContext } from '@/lib/prompts'
import {
  pareceMensajeAutomaticoNegocio,
  RESPUESTA_OUTBOUND_TRAS_AUTOMATICO,
} from '@/lib/outbound-auto-reply'
import { enviarMensajeWassenger } from '@/lib/wassenger'
import { obtenerConfigConversacional } from '@/lib/conversation-config'
import { decidirRespuestaConversacional } from '@/lib/response-decision'
import { registrarEventoConversacional } from '@/lib/conversation-events'
import {
  auditarCoherenciaRubro,
  fallbackSeguroPorVertical,
  instruccionRegeneracion,
  sanitizarRespuestaModelo,
} from '@/lib/response-guardrails'
import { detectarVertical, sanitizarApexInfoPorVertical } from '@/lib/verticales'

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

    const apexInfoTextoRaw = (apexInfo ?? [])
      .map(info => `[${info.categoria.toUpperCase()}] ${info.titulo}\n${info.contenido}`)
      .join('\n\n')

    const verticalLead = detectarVertical(
      String(lead.rubro ?? ''),
      lead.descripcion as string | null | undefined
    )
    const apexInfoSanitizado = sanitizarApexInfoPorVertical(apexInfoTextoRaw, verticalLead)
    const apexInfoTexto = apexInfoSanitizado.texto
    if (apexInfoSanitizado.removidas.length) {
      console.log(
        '[AGENTE] apex_info filtrado por vertical',
        verticalLead,
        '→ removidas:',
        apexInfoSanitizado.removidas
      )
    }

    // 5. Traer historial
    console.log('[AGENTE] Cargando historial de conversación...')
    const { data: historial } = await supabase
      .from('conversaciones')
      .select('rol, mensaje, timestamp')
      .eq('lead_id', lead.id)
      .order('timestamp', { ascending: true })
      .limit(20)

    const filasHistorial = historial ?? []

    const configConversacional = await obtenerConfigConversacional()
    const decision = decidirRespuestaConversacional({
      message: mensaje_nuevo,
      history: filasHistorial.map(h => ({
        rol: h.rol as 'agente' | 'cliente',
        mensaje: h.mensaje,
      })),
      config: configConversacional,
    })

    await registrarEventoConversacional({
      leadId: lead.id,
      telefono: lead.telefono,
      eventName: decision.eventName,
      decisionAction: decision.action,
      decisionReason: decision.reason,
      confidence: decision.confidence,
      metadata: { source: 'agente.ts' },
    })

    if (decision.disableAgent) {
      await supabase
        .from('leads')
        .update({
          estado: 'no_interesado',
          agente_activo: false,
          conversacion_cerrada: true,
          conversacion_cerrada_at: new Date().toISOString(),
        })
        .eq('id', lead.id)
      return { respuesta: null }
    }

    if (decision.closeConversation) {
      await supabase
        .from('leads')
        .update({
          conversacion_cerrada: true,
          conversacion_cerrada_at: new Date().toISOString(),
        })
        .eq('id', lead.id)
    } else if (lead.conversacion_cerrada) {
      await supabase
        .from('leads')
        .update({ conversacion_cerrada: false, conversacion_cerrada_at: null })
        .eq('id', lead.id)
    }

    if (decision.action === 'no_reply' || decision.action === 'close_conversation') {
      return { respuesta: null }
    }

    if (decision.action === 'micro_ack') {
      return { respuesta: 'Gracias por el mensaje. Si querés, te paso el siguiente paso en 1 línea.' }
    }

    if (decision.action === 'handoff_human') {
      return {
        respuesta:
          'Dale, ya tengo lo que necesito. En menos de 24 horas te mando el boceto para que lo veas, y si te gusta avanzamos.',
      }
    }

    if (decision.action === 'confirm_close') {
      await supabase
        .from('leads')
        .update({
          estado: 'interesado',
          conversacion_cerrada: true,
          conversacion_cerrada_at: new Date().toISOString(),
        })
        .eq('id', lead.id)
      return {
        respuesta: 'Genial. Te escribe alguien del equipo a la brevedad para coordinar los detalles.',
      }
    }

    const cantidadMensajesAgente = filasHistorial.filter(h => h.rol === 'agente').length
    if (
      lead.origen === 'outbound' &&
      cantidadMensajesAgente <= 1 &&
      pareceMensajeAutomaticoNegocio(mensaje_nuevo)
    ) {
      console.log('[AGENTE] Outbound: mensaje del cliente parece respuesta automática del negocio')
      await registrarEventoConversacional({
        leadId: lead.id,
        telefono: lead.telefono,
        eventName: 'outbound_auto_business_reply',
        decisionAction: 'full_reply',
        decisionReason: decision.reason,
        confidence: decision.confidence,
        metadata: { source: 'agente.ts' },
      })
      return { respuesta: RESPUESTA_OUTBOUND_TRAS_AUTOMATICO }
    }

    const historialTexto = filasHistorial
      .map(h => `[${h.rol === 'agente' ? 'APEX' : 'CLIENTE'}] ${h.mensaje}`)
      .join('\n')

    const contextoLead = {
      nombre: String(lead.nombre ?? ''),
      rubro: String(lead.rubro ?? ''),
      zona: String(lead.zona ?? ''),
      descripcion: lead.descripcion as string | null | undefined,
      mensajeInicial: lead.mensaje_inicial as string | null | undefined,
    }

    // 6. Construir prompt según origen
    console.log('[AGENTE] Construyendo prompt del sistema...')
    const systemPrompt = buildAgentPrompt(
      lead.origen as 'outbound' | 'inbound',
      apexInfoTexto,
      historialTexto,
      contextoLead
    )

    const userContent = buildUserMessageWithLeadContext(mensaje_nuevo, contextoLead)

    // 7. Llamar a Claude
    console.log('[AGENTE] Llamando a Claude Sonnet...')
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    })

    const respuestaRaw = response.content[0].type === 'text' ? response.content[0].text : ''
    let chequeo = auditarCoherenciaRubro(
      respuestaRaw,
      String(lead.rubro ?? ''),
      lead.descripcion as string | null | undefined
    )

    // Capa 2: si detectamos mezcla de rubros, regeneramos con prompt endurecido.
    if (chequeo.texto && chequeo.intrusa) {
      console.warn(
        '[AGENTE] Mezcla de vertical detectada → regenerando.',
        'lead:',
        chequeo.verticalLead,
        'intrusa:',
        chequeo.intrusa
      )
      await registrarEventoConversacional({
        leadId: lead.id,
        telefono: lead.telefono,
        eventName: 'rubro_mismatch_detected',
        decisionAction: 'full_reply',
        decisionReason: decision.reason,
        confidence: decision.confidence,
        metadata: {
          source: 'agente.ts',
          verticalLead: chequeo.verticalLead,
          intrusa: chequeo.intrusa,
        },
      })

      const regenInstruccion = instruccionRegeneracion({
        verticalLead: chequeo.verticalLead,
        intrusa: chequeo.intrusa,
        textoAnterior: chequeo.texto,
        rubroLiteral: String(lead.rubro ?? ''),
        nombre: String(lead.nombre ?? ''),
      })

      try {
        const retry = await client.messages.create({
          model: 'claude-sonnet-4-5',
          max_tokens: 500,
          system: systemPrompt,
          messages: [
            { role: 'user', content: userContent },
            { role: 'assistant', content: chequeo.texto },
            { role: 'user', content: regenInstruccion },
          ],
        })
        const retryRaw = retry.content[0].type === 'text' ? retry.content[0].text : ''
        const retryChequeo = auditarCoherenciaRubro(
          retryRaw,
          String(lead.rubro ?? ''),
          lead.descripcion as string | null | undefined
        )
        if (retryChequeo.texto && retryChequeo.ok) {
          chequeo = retryChequeo
          console.log('[AGENTE] Regeneración exitosa')
        } else {
          console.warn('[AGENTE] Regeneración falló, aplicando fallback seguro')
          chequeo = {
            texto: fallbackSeguroPorVertical(chequeo.verticalLead, String(lead.nombre ?? '')),
            verticalLead: chequeo.verticalLead,
            intrusa: null,
            ok: true,
          }
          await registrarEventoConversacional({
            leadId: lead.id,
            telefono: lead.telefono,
            eventName: 'rubro_regen_failed_fallback',
            decisionAction: 'full_reply',
            decisionReason: decision.reason,
            confidence: decision.confidence,
            metadata: {
              source: 'agente.ts',
              verticalLead: chequeo.verticalLead,
              intrusaOriginal: retryChequeo.intrusa,
            },
          })
        }
      } catch (e: any) {
        console.error('[AGENTE] Error regenerando respuesta:', e?.message)
        chequeo = {
          texto: fallbackSeguroPorVertical(chequeo.verticalLead, String(lead.nombre ?? '')),
          verticalLead: chequeo.verticalLead,
          intrusa: null,
          ok: true,
        }
      }
    }

    const respuesta = sanitizarRespuestaModelo(chequeo.texto)
    if (!respuesta) {
      await registrarEventoConversacional({
        leadId: lead.id,
        telefono: lead.telefono,
        eventName: 'llm_blocked_guardrail',
        decisionAction: 'full_reply',
        decisionReason: decision.reason,
        confidence: decision.confidence,
        metadata: { source: 'agente.ts' },
      })
      return { respuesta: null }
    }
    console.log('[AGENTE] Respuesta generada exitosamente')

    await registrarEventoConversacional({
      leadId: lead.id,
      telefono: lead.telefono,
      eventName: 'full_reply_generated',
      decisionAction: 'full_reply',
      decisionReason: decision.reason,
      confidence: decision.confidence,
      metadata: { source: 'agente.ts', length: respuesta.length },
    })

    return { respuesta }
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
        manual: true,
      })
    }

    console.log('[AGENTE] Mensaje enviado exitosamente')
    return { ok: true }
  } catch (error: any) {
    console.error('[AGENTE] Error enviando mensaje:', error.message)
    return { ok: false, error: error.message }
  }
}
