import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_CHAT_MODEL } from '@/lib/anthropic-model'
import { listDemos } from '@/lib/demos-repo'
import { matchDemoFromTexts } from '@/lib/demo-match'
import type { ProjectRow } from '@/lib/projects'

export interface ContextoPrimerMensaje {
  nombre: string
  rubro: string
  zona?: string | null
  descripcion?: string | null
  instagram?: string | null
  /**
   * URL de la página personalizada del negocio (proyecto Carta — `public.leads.pagina_url`).
   * Si está presente, se prefiere por sobre cualquier demo genérica por rubro: es la propia
   * web del lead. Cuando viene seteada, se saltea por completo la búsqueda de demos (ahorra
   * una lectura a la DB). Si está vacía/ausente, se cae al match de demo por rubro (sin cambios).
   */
  paginaUrl?: string | null
}

// Prompt para APEX (legacy, hardcoded): el flujo original de la agencia web.
const SYSTEM_PROMPT_APEX = `Sos quien redacta el primer contacto de WhatsApp para APEX (desarrollo web/apps, Buenos Aires).
Generá UN solo mensaje para este negocio: tono semiformal rioplatense (vos), breve y humano.

REGLAS (alineadas al asistente APEX):
- Entre 80 y 350 caracteres. Nunca más de 420. Como WhatsApp real, no email.
- No uses emojis en este primer mensaje.
- Podés usar *negrita* de WhatsApp solo para 1-2 palabras clave (ej. *APEX*, *boceto gratis*).
- Mencioná algo ESPECÍFICO del negocio (rubro, zona, lo que venga en el contexto).
- Si el contexto indica que hay una demo disponible para el rubro, incluí UNA frase corta mencionando esa demo y su URL, de forma natural.
- Siempre agregá una frase breve invitando a visitar www.theapexweb.com para ver más trabajos o conocer mejor a APEX (no reemplaza la demo; va como complemento).
- Ofrecé un boceto gratuito de cómo podría verse su web, sin ser agresivo.
- Devolvé SOLO el texto del mensaje, sin comillas ni explicaciones.`

/** Para proyectos != APEX, el prompt se construye dinámicamente a partir de la plantilla del proyecto. */
function buildSystemPromptDesdeProyecto(project: ProjectRow): string {
  const desc = (project.descripcion ?? '').trim()
  const url = (project.url_publica ?? '').trim()
  const plantilla = (project.plantilla_primer_mensaje ?? '').trim()

  return `Sos quien redacta el primer contacto de WhatsApp para ${project.nombre}${desc ? ' — ' + desc : ''}.
Generá UN solo mensaje para este negocio: tono semiformal rioplatense (vos), breve y humano.

REGLAS GENERALES:
- Entre 80 y 350 caracteres. Nunca más de 420. Como WhatsApp real, no email.
- No uses emojis en este primer mensaje.
- Podés usar *negrita* de WhatsApp solo para 1-2 palabras clave (ej. *${project.nombre}*).
- Mencioná algo ESPECÍFICO del negocio (rubro, zona, lo que venga en el contexto).
${url ? `- Si encaja naturalmente, podés sugerir visitar ${url} (no obligatorio).` : ''}
- Devolvé SOLO el texto del mensaje, sin comillas ni explicaciones.

PROPUESTA DEL PROYECTO (seguila al pie):
${plantilla || '(No hay plantilla definida para este proyecto. Avisá al usuario que complete plantilla_primer_mensaje en el panel del proyecto.)'}`
}

export async function generarPrimerMensaje(
  ctx: ContextoPrimerMensaje,
  project: ProjectRow,
): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[generarPrimerMensaje] Falta ANTHROPIC_API_KEY')
    return null
  }

  // Si el proyecto NO es APEX y no tiene plantilla configurada, no inventamos:
  // mejor no enviar nada que mandar un mensaje sin propuesta clara.
  if (project.slug !== 'apex' && !(project.plantilla_primer_mensaje ?? '').trim()) {
    console.warn(
      '[generarPrimerMensaje] Proyecto sin plantilla configurada — saltando lead:',
      project.slug,
    )
    return null
  }

  const systemPrompt =
    project.slug === 'apex' ? SYSTEM_PROMPT_APEX : buildSystemPromptDesdeProyecto(project)

  try {
    // Página personalizada del negocio (proyecto Carta). Si el lead ya tiene su propia
    // web generada, la preferimos por sobre cualquier demo genérica por rubro y salteamos
    // listDemos()/matchDemoFromTexts() (ahorra una lectura a la DB y es su propia página).
    const paginaUrl = (ctx.paginaUrl ?? '').trim()

    // Las demos solo se buscan para APEX (es el flujo que las usa).
    let demoDisponible = ''
    if (paginaUrl) {
      demoDisponible = `Página personalizada del negocio (preferí ESTA sobre cualquier demo, es su propia web): ${paginaUrl}`
    } else if (project.slug === 'apex') {
      const demos = await listDemos()
      const match = matchDemoFromTexts(demos, {
        rubroGuardado: ctx.rubro,
        textos: [ctx.descripcion || '', ctx.nombre || '', ctx.rubro || ''],
      })
      demoDisponible = match.demo
        ? `Demo disponible para este rubro: ${match.demo.rubro_label} — ${match.demo.url}`
        : 'Demo disponible: ninguna (sin match fuerte)'
    }

    const contexto = [
      `Negocio: ${ctx.nombre}`,
      `Rubro: ${ctx.rubro}`,
      `Zona: ${ctx.zona || 'Buenos Aires'}`,
      ctx.descripcion ? `Contexto: ${ctx.descripcion}` : '',
      ctx.instagram ? `Instagram: ${ctx.instagram}` : '',
      demoDisponible,
    ]
      .filter(Boolean)
      .join('\n')

    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: ANTHROPIC_CHAT_MODEL,
      max_tokens: 300,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Generá el mensaje de WhatsApp para este negocio.\n\nContexto:\n${contexto}`,
        },
      ],
    })

    const texto = response.content[0]?.type === 'text' ? response.content[0].text : ''
    const limpio = texto.trim()
    return limpio || null
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[generarPrimerMensaje] Error:', msg)
    return null
  }
}
