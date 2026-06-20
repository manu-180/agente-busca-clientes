/**
 * Respuestas "canned" (deterministas) del motor de decisión, scopeadas por proyecto.
 *
 * APEX es una agencia: su próximo paso es el boceto / que un humano coordine, y sus
 * textos están calibrados — se conservan TAL CUAL.
 *
 * Los proyectos self-serve (Assistify, etc.) son productos que el cliente USA: no hay
 * boceto, ni "te escribe alguien para coordinar", ni theapexweb.com. El único objetivo
 * es que el cliente PRUEBE la app, así que toda respuesta determinista empuja al
 * próximo paso real: descargar / abrir la app (link en la plantilla del proyecto).
 *
 * Pasar `null` como project equivale a APEX (default histórico del programa).
 */
import type { ProjectRow } from '@/lib/projects'
import { esProyectoGratis, linkDescargaProyecto } from '@/lib/projects'
import { normalizarPaginaUrlCarta } from '@/lib/carta-url'
import { RESPUESTA_OUTBOUND_TRAS_AUTOMATICO } from '@/lib/outbound-auto-reply'
import { MENSAJE_COMPROMISO_BOCETO_24H } from '@/lib/mensaje-boceto-24h'

/** Prefijo compartido por ambas variantes (se usa para deduplicar en el webhook). */
export const PREFIJO_RESPUESTA_AUTO =
  'Gracias por la info. Eso suele ser el mensaje automático del negocio: *la propuesta ya quedó arriba* en nuestro primer mensaje.'

function esApex(project: ProjectRow | null | undefined): boolean {
  return !project || project.slug === 'apex'
}

/**
 * Respuesta cuando, en outbound, el negocio contesta con su auto-reply de WhatsApp
 * Business (horarios, "gracias por comunicarte", etc.). No empuja venta nueva: solo
 * reconoce y deja el próximo paso a mano.
 *
 * @param downloadLink  Link de descarga/acceso del proyecto. Anti-ban (Fase 2): para
 *   proyectos self-serve el link vive en project_info (no en plantilla_primer_mensaje),
 *   así que el llamador debe pasarlo explícitamente tras leerlo de project_info.
 *   Si no se pasa, se intenta leer de plantilla_primer_mensaje (compatibilidad).
 */
export function respuestaTrasAutomatico(
  project: ProjectRow | null | undefined,
  downloadLink?: string | null,
): string {
  if (esApex(project)) return RESPUESTA_OUTBOUND_TRAS_AUTOMATICO
  const link = normalizarPaginaUrlCarta(downloadLink ?? linkDescargaProyecto(project!))
  if (link) {
    const gratis = esProyectoGratis(project!) ? ' (es gratis)' : ''
    return `${PREFIJO_RESPUESTA_AUTO}\n\nCuando quieras la probás${gratis}: ${link}`
  }
  return `${PREFIJO_RESPUESTA_AUTO}\n\nCuando quieras la vemos con calma.`
}

/**
 * Cliente dio señal de compromiso ("dale", "lo quiero", "quiero empezar").
 * APEX: deriva a un humano para coordinar. Self-serve: NO hay nada que coordinar —
 * el cliente ya decidió, así que se le facilita probar la app ahora mismo.
 *
 * @param downloadLink  Ver `respuestaTrasAutomatico`.
 */
export function mensajeCierreInteresado(
  project: ProjectRow | null | undefined,
  downloadLink?: string | null,
): string {
  if (esApex(project)) {
    return 'Genial. Te escribe alguien del equipo a la brevedad para coordinar los detalles.'
  }
  const link = normalizarPaginaUrlCarta(downloadLink ?? linkDescargaProyecto(project!))
  const gratis = esProyectoGratis(project!) ? ' gratis' : ''
  if (link) {
    return `Buenísimo. La bajás${gratis} acá y en un par de minutos la tenés andando: ${link}. Cualquier cosa por acá estoy.`
  }
  return `Buenísimo. La probás directo — son un par de minutos y la tenés andando. Cualquier cosa por acá estoy.`
}

/**
 * Cliente pide "hablar con una persona / un asesor".
 * APEX: compromete el boceto en 24h. Self-serve: ya está hablando con una persona real
 * (vos), así que se ofrece ayuda directa por el chat + el paso de probar la app.
 *
 * @param downloadLink  Ver `respuestaTrasAutomatico`.
 */
export function mensajeHandoffHumano(
  project: ProjectRow | null | undefined,
  downloadLink?: string | null,
): string {
  if (esApex(project)) return MENSAJE_COMPROMISO_BOCETO_24H
  const link = normalizarPaginaUrlCarta(downloadLink ?? linkDescargaProyecto(project!))
  const gratis = esProyectoGratis(project!) ? ' gratis' : ''
  if (link) {
    return `Dale, contame qué necesitás y te ayudo por acá mismo. Si querés ya probarla, la bajás${gratis} acá: ${link}`
  }
  return 'Dale, contame qué necesitás y te ayudo por acá mismo.'
}
