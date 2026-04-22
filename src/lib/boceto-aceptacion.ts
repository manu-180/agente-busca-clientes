/** Persistir "aceptó boceto" solo si el contexto del agente hablaba de boceto (no otras propuestas). */

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

export function contextoBocetoEnUltimoMensajeAgente(mensaje: string | null | undefined): boolean {
  if (!mensaje) return false
  const n = normalizar(mensaje)
  return n.includes('boceto') || n.includes('bocetos')
}

/**
 * @param eventName — eventName devuelto por decidirRespuestaConversacional
 */
export function debePersistirBocetoAceptado(
  eventName: string,
  ultimoMensajeAgente: string | null | undefined
): boolean {
  if (!contextoBocetoEnUltimoMensajeAgente(ultimoMensajeAgente)) return false
  if (eventName === 'confirm_close_proposal_ack') return true
  if (eventName === 'confirm_close_commit_signal') return true
  return false
}
