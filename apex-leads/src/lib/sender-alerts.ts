// Alertas del pool de envío WhatsApp (Evolution). Hoy: aviso de baneo de chip.
//
// Dos canales, ambos best-effort (NUNCA tiran — un fallo de alerta no puede
// romper el flujo de baneo/promoción del pool):
//   1. Persistencia en `alerts_log` (audit + panel). Igual que las alertas de IG.
//   2. Email vía Resend (RESEND_API_KEY + ALERT_EMAIL) — el canal elegido por
//      Manuel para enterarse de que tiene que reponer un chip.
//
// El caller (webhook / cron) debe invocar esto SOLO en la transición a baneo
// (no en cada connection.update repetido), así no spamea.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface SenderBanAlertInput {
  /** Alias legible del sender baneado (ej. "Manu celu actual"). */
  alias: string | null
  /** instance_name de Evolution (para el metadata / debug). */
  instanceName: string
  /** Razón del baneo: device_removed | code_403. */
  reason: string
  /** Alias del sender que se promovió de la reserva para cubrir la baja, o null
   *  si no había ninguno disponible (en cuyo caso hay que reponer urgente). */
  promotedAlias?: string | null
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const RESEND_FROM = 'APEX Alerts <alerts@apex-leads.com>'

function construirMensaje(input: SenderBanAlertInput): string {
  const nombre = input.alias ?? input.instanceName
  if (input.promotedAlias) {
    return (
      `⚠️ Chip de WhatsApp baneado: "${nombre}" (${input.reason}). ` +
      `Promoví "${input.promotedAlias}" desde la reserva para mantener el pool. ` +
      `Cuando puedas, sumá un chip nuevo a la reserva.`
    )
  }
  return (
    `🚨 Chip de WhatsApp baneado: "${nombre}" (${input.reason}). ` +
    `No había reserva para reemplazarlo, así que el pool quedó más chico. ` +
    `Reponé un chip lo antes posible.`
  )
}

async function persistirEnLog(
  supabase: SupabaseClient,
  message: string,
  input: SenderBanAlertInput
): Promise<void> {
  try {
    await supabase.from('alerts_log').insert({
      severity: 'critical',
      source: 'sender-pool',
      message,
      metadata: {
        instance_name: input.instanceName,
        reason: input.reason,
        promoted: input.promotedAlias ?? null,
      },
    })
  } catch (err) {
    console.error('[sender-alerts] no se pudo persistir en alerts_log:', err)
  }
}

async function enviarEmail(message: string, input: SenderBanAlertInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const toEmail = process.env.ALERT_EMAIL
  if (!apiKey || !toEmail) return

  const nombre = input.alias ?? input.instanceName
  try {
    await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [toEmail],
        subject: `🚨 Chip de WhatsApp baneado: ${nombre}`,
        html:
          `<p>${message}</p>` +
          `<ul>` +
          `<li><strong>Instancia:</strong> ${input.instanceName}</li>` +
          `<li><strong>Razón:</strong> ${input.reason}</li>` +
          `<li><strong>Reemplazo:</strong> ${input.promotedAlias ?? '— (sin reserva)'}</li>` +
          `</ul>`,
      }),
    })
  } catch (err) {
    console.error('[sender-alerts] Resend falló (no bloquea):', err)
  }
}

/**
 * Avisa que un chip del pool fue baneado por WhatsApp. Persiste en `alerts_log`
 * (panel) y manda email vía Resend si está configurado. Best-effort: nunca tira.
 */
export async function alertSenderBanned(
  supabase: SupabaseClient,
  input: SenderBanAlertInput
): Promise<void> {
  const message = construirMensaje(input)
  await persistirEnLog(supabase, message, input)
  await enviarEmail(message, input)
}
