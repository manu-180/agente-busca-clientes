// Construcción del PRIMER mensaje de contacto en frío (cold outreach WhatsApp).
//
// Anti-ban (Fase 2 🔴): el mensaje default NO lleva links. Los links en frío
// disparan spam-detection y reportes → baneos. El boceto/demo se manda recién
// cuando el lead responde (ver el contexto [BOCETO] del webhook). El mensaje
// abre conversación con una pregunta y ofrece opt-out para que la gente responda
// en vez de reportar.
//
// Las plantillas por proyecto (`projects.plantilla_primer_mensaje`) siguen
// soportando variables, incluido {{demo_url}}; el criterio "sin link en frío" se
// aplica editando esas plantillas en la DB (las de Carta/Assistify son copy de
// producto que maneja Manuel).

import {
  extraerRatingParaPlantilla,
  resolveWhatsAppDemoHost,
  SITIO_PRINCIPAL_APEX,
} from '@/lib/whatsapp-template-demos'
import { normalizarPaginaUrlCarta } from '@/lib/carta-url'

/** Campos del lead que el primer mensaje necesita (subconjunto de LeadColaRow). */
export interface PrimerMensajeLead {
  nombre: string
  rubro: string
  zona: string
  descripcion: string
  pagina_url: string | null
}

/** Interpola una plantilla de proyecto con los datos del lead. */
export function interpolarPlantilla(
  template: string,
  lead: PrimerMensajeLead,
  rating: string,
  demoHost: string,
): string {
  return template
    .replace(/\{\{nombre\}\}/g, lead.nombre)
    .replace(/\{\{rating\}\}/g, rating)
    .replace(/\{\{zona\}\}/g, lead.zona)
    .replace(/\{\{rubro\}\}/g, lead.rubro)
    .replace(/\{\{demo_url\}\}/g, demoHost)
    .replace(/\{\{sitio\}\}/g, SITIO_PRINCIPAL_APEX)
}

/**
 * Construye el primer mensaje para un lead.
 *
 * - Con `plantilla` del proyecto → interpola sus variables (soporta {{demo_url}}).
 * - Sin plantilla → mensaje default de APEX, **sin link** (anti-ban): gancho
 *   personalizado + opt-out + cierre con pregunta. El boceto se ofrece al responder.
 */
export function construirMensajePrimerContacto(
  lead: PrimerMensajeLead,
  plantilla?: string | null,
): string {
  const rating = extraerRatingParaPlantilla(lead.descripcion)

  // Plantilla personalizada del proyecto (Carta, Assistify, etc.).
  if (plantilla?.trim()) {
    const demoHost =
      normalizarPaginaUrlCarta(lead.pagina_url) ||
      resolveWhatsAppDemoHost(lead.rubro, lead.descripcion)
    return interpolarPlantilla(plantilla, lead, rating, demoHost)
  }

  // Mensaje default de APEX — SIN link en el primer toque (anti-ban).
  // El boceto se manda cuando responden (lo sugiere el contexto [BOCETO] del agente).
  return [
    `Hola ${lead.nombre}, ¿cómo va?`,
    `Vi tu ${lead.rubro} en ${lead.zona} en Google (${rating}⭐) y me puse a armar un boceto de página web para mostrarte cómo quedaría el tuyo.`,
    `Si te interesa te lo paso, y si no, avisame y no te escribo más 🙌`,
    `¿Lo querés ver?`,
  ].join('\n')
}
