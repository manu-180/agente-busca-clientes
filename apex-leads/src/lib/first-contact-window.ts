/**
 * Ventana de envío de primer contacto (WhatsApp / Twilio) en hora Argentina.
 * Misma regla en cron `leads-pendientes`, `queue-stats` y copy de UI.
 */
export const PRIMER_CONTACTO_HORA_INICIO_AR = 9
export const PRIMER_CONTACTO_HORA_FIN_AR = 18

/** `true` = ignora 9–18 h (solo para pruebas). Producción: `false`. */
export const PRIMER_CONTACTO_SIN_RESTRICCION_HORARIA = false

const TZ_ARGENTINA = 'America/Argentina/Buenos_Aires'

/** Hora local Argentina (0–23) en el instante dado. */
export function getHoraArgentina(fecha: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ_ARGENTINA,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(fecha)
  const h = parts.find((p) => p.type === 'hour')?.value
  return parseInt(h ?? '0', 10)
}

export function estaEnVentanaPrimerContacto(fecha: Date = new Date()): boolean {
  if (PRIMER_CONTACTO_SIN_RESTRICCION_HORARIA) return true
  const h = getHoraArgentina(fecha)
  return h >= PRIMER_CONTACTO_HORA_INICIO_AR && h < PRIMER_CONTACTO_HORA_FIN_AR
}
