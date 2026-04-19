const WASSENGER_BASE = 'https://api.wassenger.com/v1'

function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'Token': process.env.WASSENGER_API_KEY!,
  }
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

export async function enviarMensajeWassenger(telefono: string, mensaje: string) {
  const response = await fetch(`${WASSENGER_BASE}/messages`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      phone: telefono,
      message: mensaje,
      device: process.env.WASSENGER_DEVICE_ID,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Wassenger error: ${response.status} - ${error}`)
  }

  return response.json()
}

export async function enviarVideoWassenger(telefono: string, videoUrl: string, caption?: string) {
  const response = await fetch(`${WASSENGER_BASE}/messages`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      phone: telefono,
      device: process.env.WASSENGER_DEVICE_ID,
      media: {
        url: videoUrl,
        ...(caption ? { caption } : {}),
      },
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Wassenger media error: ${response.status} - ${error}`)
  }

  return response.json()
}

export interface ResultadoEnvioVideo {
  ok: boolean
  intentos: number
  error?: string
}

// El video a veces falla porque Wassenger tiene que descargar la URL;
// reintenta con backoff exponencial (2s, 4s, 8s).
export async function enviarVideoWassengerConReintentos(
  telefono: string,
  videoUrl: string,
  maxIntentos = 3,
  caption?: string
): Promise<ResultadoEnvioVideo> {
  let ultimoError: string | null = null

  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      await enviarVideoWassenger(telefono, videoUrl, caption)
      return { ok: true, intentos: intento }
    } catch (e) {
      ultimoError = e instanceof Error ? e.message : String(e)
      console.warn(
        `[Wassenger] Envío de video falló (intento ${intento}/${maxIntentos}):`,
        ultimoError
      )
      if (intento < maxIntentos) {
        await sleep(Math.pow(2, intento) * 1000)
      }
    }
  }

  return { ok: false, intentos: maxIntentos, error: ultimoError ?? 'desconocido' }
}

export async function verificarConexionWassenger() {
  try {
    const response = await fetch(`${WASSENGER_BASE}/devices`, {
      headers: getHeaders(),
    })
    if (!response.ok) return { ok: false, error: 'API key inválida' }
    const devices = await response.json()
    return { ok: true, devices }
  } catch (error) {
    return { ok: false, error: 'No se pudo conectar con Wassenger' }
  }
}
