import { isTelefonoHardBlocked } from '@/lib/phone-blocklist'

function getTwilioAuth() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID!
  const authToken = process.env.TWILIO_AUTH_TOKEN!
  return 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64')
}

export type EnviarMensajeTwilioOptions = {
  /**
   * Respuestas del webhook a conversación entrante: permitir aunque el destino
   * esté en la lista de no-contacto (evita self-tests entre líneas propias y bloqueo 2720).
   * El cold outreach (cron, followup) sigue consultando el bloqueo antes de enviar.
   */
  skipBlockCheck?: boolean
}

export async function enviarMensajeTwilio(
  telefono: string,
  mensaje: string,
  fromNumber?: string,
  options?: EnviarMensajeTwilioOptions
) {
  if (!options?.skipBlockCheck && isTelefonoHardBlocked(telefono)) {
    throw new Error('TELEFONO_BLOQUEADO')
  }
  const accountSid = process.env.TWILIO_ACCOUNT_SID!
  const from = fromNumber ?? process.env.TWILIO_WHATSAPP_NUMBER!

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: getTwilioAuth(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        From: `whatsapp:${from}`,
        To: `whatsapp:+${telefono}`,
        Body: mensaje,
      }).toString(),
    }
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Twilio error: ${res.status} - ${err}`)
  }

  return res.json()
}
