import { isTelefonoHardBlocked } from '@/lib/phone-blocklist'

// Re-export del tipo del pool para que callers (cron, dashboard) puedan
// importar `PoolSender` desde `lib/evolution.ts` sin tirar de `lib/sender-pool.ts`
// (evita imports cíclicos cuando el pool importe del cron en el futuro).
export type { PoolSender } from './sender-pool'

export type EvolutionSender = {
  id: string
  alias: string | null
  phone_number: string
  instance_name: string
  activo: boolean
}

function getEvolutionConfig(): { url: string; key: string } {
  const url = process.env.EVOLUTION_API_URL
  const key = process.env.EVOLUTION_API_KEY
  if (!url || !key) throw new Error('EVOLUTION_API_URL o EVOLUTION_API_KEY no configuradas')
  return { url: url.replace(/\/$/, ''), key }
}

export type EnviarMensajeEvolutionOptions = {
  /**
   * Respuestas a mensajes entrantes: no consultar lista de bloqueo para evitar
   * cortar conversaciones iniciadas por el cliente. Cold outreach sí la consulta.
   */
  skipBlockCheck?: boolean
}

export async function enviarMensajeEvolution(
  telefono: string,
  texto: string,
  instanceName: string,
  options?: EnviarMensajeEvolutionOptions
): Promise<{ messageId: string | null }> {
  if (!options?.skipBlockCheck && isTelefonoHardBlocked(telefono)) {
    throw new Error('TELEFONO_BLOQUEADO')
  }
  const { url, key } = getEvolutionConfig()
  const res = await fetch(`${url}/message/sendText/${instanceName}`, {
    method: 'POST',
    headers: {
      apikey: key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ number: telefono, text: texto }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Evolution API error: ${res.status} - ${err}`)
  }
  const data = await res.json() as { key?: { id?: string } }
  return { messageId: data?.key?.id ?? null }
}
