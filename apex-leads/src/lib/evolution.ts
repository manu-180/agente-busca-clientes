// Cliente Evolution API con blindaje contra desconexiones.
//
// Garantías:
// 1. Pre-flight: chequea `connectionState` antes de mandar. Si la sesión no
//    está `open`, falla con `EVO_INSTANCE_NOT_CONNECTED` SIN tocar Evolution.
//    Esto evita el bug donde Baileys devuelve 200 con buffer interno aunque
//    la sesión esté caída → contador de mensajes inflado pero nada se entregó.
//
// 2. Timeout: AbortController con 15 s. Si Railway está colgado, fallamos
//    rápido en vez de bloquear el cron 30 s.
//
// 3. Retry idempotente: 1 reintento con backoff de 1 s para errores 5xx y
//    timeouts. Errores 4xx (lógica de WhatsApp: número inválido, etc.) NO
//    se reintentan.
//
// 4. Errores tipados: el caller (cron, webhook) puede distinguir entre
//    "la sesión está caída → marcar disconnected y elegir otro sender"
//    y "el número es inválido → descartar el lead".

import { isTelefonoHardBlocked } from '@/lib/phone-blocklist'
import { getInstanceState } from '@/lib/evolution-instance'

// Re-export del tipo del pool para que callers (cron, dashboard) puedan
// importar `PoolSender` desde `lib/evolution.ts` sin tirar de `lib/sender-pool.ts`.
export type { PoolSender } from './sender-pool'

export type EvolutionSender = {
  id: string
  alias: string | null
  phone_number: string
  instance_name: string
  activo: boolean
}

/**
 * Códigos de error tipados que `enviarMensajeEvolution` puede lanzar.
 * El caller los lee desde `(err as Error).message.startsWith('EVO_')` o
 * usando `isEvolutionError()`.
 */
export const EVO_ERR = {
  /** Bloqueado por la lista de teléfonos hardcoded (no es falla técnica). */
  TELEFONO_BLOQUEADO: 'TELEFONO_BLOQUEADO',
  /** La sesión Multi-Device no está `open`. Hay que marcar disconnected y elegir otro sender. */
  INSTANCE_NOT_CONNECTED: 'EVO_INSTANCE_NOT_CONNECTED',
  /** Timeout de red contra Evolution (Railway lento o caído). Reintentable. */
  TIMEOUT: 'EVO_TIMEOUT',
  /** 5xx de Evolution. Reintentable. */
  SERVER_ERROR: 'EVO_SERVER_ERROR',
  /** 4xx de Evolution (número inválido, formato malo, etc.). NO reintentable. */
  CLIENT_ERROR: 'EVO_CLIENT_ERROR',
} as const

export type EvoErrorCode = typeof EVO_ERR[keyof typeof EVO_ERR]

export class EvolutionError extends Error {
  readonly code: EvoErrorCode
  readonly status?: number
  readonly retryable: boolean

  constructor(code: EvoErrorCode, message: string, opts?: { status?: number; retryable?: boolean }) {
    super(message)
    this.name = 'EvolutionError'
    this.code = code
    this.status = opts?.status
    this.retryable =
      opts?.retryable ??
      (code === EVO_ERR.TIMEOUT || code === EVO_ERR.SERVER_ERROR)
  }
}

export function isEvolutionError(err: unknown): err is EvolutionError {
  return err instanceof EvolutionError
}

function getEvolutionConfig(): { url: string; key: string } {
  const url = process.env.EVOLUTION_API_URL
  const key = process.env.EVOLUTION_API_KEY
  if (!url || !key) throw new Error('EVOLUTION_API_URL o EVOLUTION_API_KEY no configuradas')
  return { url: url.replace(/\/$/, ''), key }
}

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_ATTEMPTS = 2  // 1 inicial + 1 reintento
const RETRY_BACKOFF_MS = 1_000

export type EnviarMensajeEvolutionOptions = {
  /**
   * Respuestas a mensajes entrantes: no consultar lista de bloqueo para evitar
   * cortar conversaciones iniciadas por el cliente. Cold outreach sí la consulta.
   */
  skipBlockCheck?: boolean
  /**
   * Saltarse el pre-flight `getInstanceState`. Solo para tests o cuando ya
   * verificaste el estado más arriba. NUNCA usar en código de producción salvo
   * el tester manual de /senders/[id]/test.
   */
  skipPreflight?: boolean
  /** Override del timeout (default 15 s). */
  timeoutMs?: number
  /** Override del máximo de intentos (default 2). */
  maxAttempts?: number
}

/**
 * Envía un mensaje vía Evolution API con blindaje completo.
 *
 * Lanza `EvolutionError` con códigos `EVO_*` para que el caller distinga
 * fallas reintentables (timeout, 5xx) de fallas terminales (instancia caída,
 * número inválido).
 */
export async function enviarMensajeEvolution(
  telefono: string,
  texto: string,
  instanceName: string,
  options?: EnviarMensajeEvolutionOptions
): Promise<{ messageId: string | null }> {
  if (!options?.skipBlockCheck && isTelefonoHardBlocked(telefono)) {
    throw new EvolutionError(EVO_ERR.TELEFONO_BLOQUEADO, 'TELEFONO_BLOQUEADO', { retryable: false })
  }

  // ── Pre-flight: verificar que la sesión está open ──
  if (!options?.skipPreflight) {
    let state: Awaited<ReturnType<typeof getInstanceState>>
    try {
      state = await getInstanceState(instanceName)
    } catch (err) {
      // Si fetchInstances/connectionState falla, asumimos lo peor y no enviamos.
      // Es preferible retrasar 1 envío que mandar al vacío e inflar el contador.
      const msg = err instanceof Error ? err.message : String(err)
      throw new EvolutionError(
        EVO_ERR.SERVER_ERROR,
        `preflight getInstanceState falló: ${msg}`,
        { retryable: true }
      )
    }
    if (state !== 'open') {
      throw new EvolutionError(
        EVO_ERR.INSTANCE_NOT_CONNECTED,
        `instance ${instanceName} no está conectada (state=${state})`,
        { retryable: false }
      )
    }
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS

  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await sendOnce(telefono, texto, instanceName, timeoutMs)
    } catch (err) {
      lastErr = err
      const isRetryable = isEvolutionError(err) ? err.retryable : false
      const isLast = attempt === maxAttempts
      if (!isRetryable || isLast) throw err
      // Backoff antes del próximo intento
      await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS))
    }
  }
  // Inalcanzable: el loop arriba siempre retorna o lanza.
  throw lastErr
}

async function sendOnce(
  telefono: string,
  texto: string,
  instanceName: string,
  timeoutMs: number
): Promise<{ messageId: string | null }> {
  const { url, key } = getEvolutionConfig()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)

  let res: Response
  try {
    res = await fetch(`${url}/message/sendText/${instanceName}`, {
      method: 'POST',
      headers: {
        apikey: key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ number: telefono, text: texto }),
      signal: ctrl.signal,
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new EvolutionError(EVO_ERR.TIMEOUT, `timeout tras ${timeoutMs}ms`, { retryable: true })
    }
    // Network errors (DNS, conn refused, etc.) tratamos como server error reintentable.
    const msg = err instanceof Error ? err.message : String(err)
    throw new EvolutionError(EVO_ERR.SERVER_ERROR, `network error: ${msg}`, { retryable: true })
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status >= 500) {
      throw new EvolutionError(
        EVO_ERR.SERVER_ERROR,
        `Evolution ${res.status}: ${body.slice(0, 300)}`,
        { status: res.status, retryable: true }
      )
    }
    throw new EvolutionError(
      EVO_ERR.CLIENT_ERROR,
      `Evolution ${res.status}: ${body.slice(0, 300)}`,
      { status: res.status, retryable: false }
    )
  }

  const data = (await res.json()) as { key?: { id?: string } }
  return { messageId: data?.key?.id ?? null }
}
