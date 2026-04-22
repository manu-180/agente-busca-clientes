import { isTelefonoHardBlocked } from '@/lib/phone-blocklist'

function getTwilioAuth() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID!
  const authToken = process.env.TWILIO_AUTH_TOKEN!
  return 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64')
}

export async function enviarMensajeTwilio(telefono: string, mensaje: string, fromNumber?: string) {
  if (isTelefonoHardBlocked(telefono)) {
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
