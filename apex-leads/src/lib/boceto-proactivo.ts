import { normalizarPaginaUrlCarta } from '@/lib/carta-url'

/**
 * ¿El agente ya compartió este link en algún momento de la conversación?
 * Normaliza protocolo y `www.` en ambos lados para tolerar variaciones de cómo el
 * modelo escribió la URL (con/sin https, con/sin www, mayúsculas, slash final).
 */
export function linkYaCompartido(link: string, mensajesAgente: string[]): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/https?:\/\//g, '').replace(/www\./g, '')
  const objetivo = norm(link).replace(/\/+$/, '')
  if (!objetivo) return false
  return mensajesAgente.some(m => typeof m === 'string' && norm(m).includes(objetivo))
}

/**
 * Construye el bloque [BOCETO] que se inyecta en <project_info> con la página REAL y
 * personalizada del lead (su `pagina_url`: la carta del restaurante en Carta, el
 * boceto ya hecho en APEX, etc.).
 *
 * Anti-ban (Fase 2): el primer mensaje en frío NO lleva link. Pero apenas el lead
 * responde algo real, ESTE es el activo más fuerte para mostrar, así que el bloque
 * instruye al agente a compartirlo PROACTIVAMENTE (generar el momento, no esperar a
 * que lo pidan) y a no cerrar la conversación sin haberlo mostrado al menos una vez
 * — una sola vez, sin parecer desesperado, y nunca ante señales rojas.
 *
 * Cuando `mensajesAgente` muestra que el link YA se compartió, el bloque cambia a
 * "no lo repitas" para no resultar insistente.
 *
 * @param paginaUrl      `leads.pagina_url` crudo (se normaliza para no exponer *.vercel.app).
 * @param mensajesAgente Mensajes previos del agente en la conversación (para saber si ya se mandó).
 * @returns el bloque listo para concatenar en <project_info>, o '' si el lead no tiene página.
 */
export function construirBloqueBoceto(
  paginaUrl: string | null | undefined,
  mensajesAgente: string[] = []
): string {
  const link = normalizarPaginaUrlCarta(paginaUrl)
  if (!link) return ''

  if (linkYaCompartido(link, mensajesAgente)) {
    return `[BOCETO] La página REAL y personalizada de ESTE negocio es: ${link}
YA se la compartiste en esta conversación. NO la repitas salvo que el cliente la pida de nuevo o pregunte por ella; repetir el mismo link en cada mensaje parece desesperado. Si la volvés a nombrar, va EXACTA, tal cual; nunca mandes otra URL, un ejemplo, un dominio genérico/raíz ni una inventada.`
  }

  return `[BOCETO] Ya hay una página REAL hecha para ESTE negocio: ${link}
Es su página personalizada (con sus propios datos y fotos), creada por el sistema — es el activo MÁS FUERTE que tenés para mostrar, y TODAVÍA NO se la compartiste en esta conversación.
Tu objetivo es que la vea: apenas el cliente responda algo real y no haya señal negativa, GENERÁ EL MOMENTO y compartísela vos mismo, sin esperar a que la pida ("mostrame", "tenés un ejemplo"). No es spam: le estás mostrando cómo le quedaría su propio negocio. Forma natural: "te dejo cómo te quedó, mirá: ${link}".
NO termines la conversación con un cliente receptivo sin haberle mostrado este link al menos una vez.
Reglas al mandarlo: va EXACTO, tal cual figura, sin acortarlo ni cambiarlo, y es el ÚNICO link que mandás para mostrar la página (nunca otra URL, ni un ejemplo, ni un dominio genérico/raíz, ni una inventada, ni un host .vercel.app). Mandalo UNA sola vez; no lo repitas en cada mensaje ni parezcas ansioso.
NO lo mandes si el cliente no es el dueño / es número equivocado, está hostil o desconfiado, o su mensaje es automático o una plantilla: primero resolvés eso con calma. EXCEPCIÓN útil: si delega ("se lo paso a…", "le aviso"), SÍ podés dejarle el link para que se lo reenvíe al decisor.`
}
