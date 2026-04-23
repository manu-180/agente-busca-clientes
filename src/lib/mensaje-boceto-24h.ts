/**
 * Mensaje que envía el canal WhatsApp (webhook) cuando el motor decide `handoff_human`:
 * el agente ya tiene info y compromete el envío del boceto en ~24h.
 * Debe coincidir con la intención del agente en `src/lib/agente.ts`.
 */
export const MENSAJE_COMPROMISO_BOCETO_24H =
  'Dale, ya tengo lo que necesito. En menos de 24 horas te mando el boceto para que lo veas, y si te gusta avanzamos.'
