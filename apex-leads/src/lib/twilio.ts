import { isTelefonoHardBlocked } from '@/lib/phone-blocklist'

type TwilioCredentials = { accountSid: string; authToken: string; whatsappNumber: string }

/** Devuelve las credenciales de la cuenta Twilio que corresponde al número `from`. */
export function getTwilioCredentials(fromNumber?: string): TwilioCredentials {
  const num2 = process.env.TWILIO_WHATSAPP_NUMBER_2
  if (num2 && fromNumber) {
    const normalizeNum = (n: string) => n.replace(/\D/g, '')
    if (normalizeNum(fromNumber) === normalizeNum(num2)) {
      return {
        accountSid: process.env.TWILIO_ACCOUNT_SID_2!,
        authToken: process.env.TWILIO_AUTH_TOKEN_2!,
        whatsappNumber: num2,
      }
    }
  }
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
    authToken: process.env.TWILIO_AUTH_TOKEN!,
    whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER!,
  }
}

function getTwilioAuth(fromNumber?: string) {
  const { accountSid, authToken } = getTwilioCredentials(fromNumber)
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
  const { accountSid, whatsappNumber } = getTwilioCredentials(fromNumber)
  const from = fromNumber ?? whatsappNumber

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: getTwilioAuth(from),
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
