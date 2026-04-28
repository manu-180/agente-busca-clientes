/**
 * Ventana de envío de primer contacto (WhatsApp / Twilio) en hora Argentina.
 * Misma regla en cron `leads-pendientes`, `queue-stats` y copy de UI.
 */
export const PRIMER_CONTACTO_HORA_INICIO_AR = 9
export const PRIMER_CONTACTO_HORA_FIN_AR = 18

// Argentina = UTC-3, sin DST. Usamos aritmética UTC pura para evitar
// inconsistencias de Intl.DateTimeFormat en distintos runtimes de Node.js.
const AR_OFFSET_MS = -3 * 60 * 60 * 1000

/** Hora local Argentina (0–23) en el instante dado. */
export function getHoraArgentina(fecha: Date = new Date()): number {
  const arMs = fecha.getTime() + AR_OFFSET_MS
  return new Date(arMs).getUTCHours()
}

export function estaEnVentanaPrimerContacto(fecha: Date = new Date()): boolean {
  const h = getHoraArgentina(fecha)
  return h >= PRIMER_CONTACTO_HORA_INICIO_AR && h < PRIMER_CONTACTO_HORA_FIN_AR
}
