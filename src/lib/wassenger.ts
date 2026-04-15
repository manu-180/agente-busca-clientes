const WASSENGER_BASE = 'https://api.wassenger.com/v1'

function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'Token': process.env.WASSENGER_API_KEY!,
  }
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
