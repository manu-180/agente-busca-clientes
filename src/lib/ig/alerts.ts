/**
 * Alert system for critical Instagram outreach events.
 * Sends to Slack webhook and/or email (Resend) based on env vars.
 * Fails silently — alerts must never crash the main flow.
 */

type AlertLevel = 'critical' | 'warning' | 'info'

interface AlertPayload {
  level: AlertLevel
  title: string
  message: string
  meta?: Record<string, string | number | boolean>
}

// ── Slack ─────────────────────────────────────────────────────────────────────

async function sendSlack(payload: AlertPayload): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL
  if (!webhookUrl) return

  const emoji = { critical: '🚨', warning: '⚠️', info: 'ℹ️' }[payload.level]

  const metaLines = payload.meta
    ? Object.entries(payload.meta)
        .map(([k, v]) => `• *${k}:* ${v}`)
        .join('\n')
    : ''

  const body = {
    text: `${emoji} *[APEX IG] ${payload.title}*`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${emoji} *[APEX IG] ${payload.title}*\n${payload.message}`,
        },
      },
      ...(metaLines
        ? [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: metaLines },
            },
          ]
        : []),
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })} ART`,
          },
        ],
      },
    ],
  }

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ── Email via Resend ──────────────────────────────────────────────────────────

async function sendEmail(payload: AlertPayload): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const toEmail = process.env.ALERT_EMAIL
  if (!apiKey || !toEmail) return

  const emoji = { critical: '🚨', warning: '⚠️', info: 'ℹ️' }[payload.level]

  const metaHtml = payload.meta
    ? `<ul>${Object.entries(payload.meta)
        .map(([k, v]) => `<li><strong>${k}:</strong> ${v}</li>`)
        .join('')}</ul>`
    : ''

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'APEX Alerts <alerts@apex-leads.com>',
      to: [toEmail],
      subject: `${emoji} [APEX IG] ${payload.title}`,
      html: `<p>${payload.message}</p>${metaHtml}`,
    }),
  })
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function sendAlert(payload: AlertPayload): Promise<void> {
  await Promise.allSettled([sendSlack(payload), sendEmail(payload)])
}

// Pre-built alert helpers

export async function alertCircuitOpen(event: string, cooldownUntil: string): Promise<void> {
  await sendAlert({
    level: 'critical',
    title: 'Circuit breaker activado',
    message: 'El outbound de Instagram está pausado automáticamente por un evento crítico.',
    meta: { evento: event, cooldown_hasta: cooldownUntil },
  })
}

export async function alertLowReplyRate(replyRate: number, dmsSent: number): Promise<void> {
  await sendAlert({
    level: 'warning',
    title: 'Reply rate bajo — posible shadowban',
    message: `El reply rate de los últimos 7 días cayó por debajo del 5%. Revisá la cuenta emisora.`,
    meta: { reply_rate: `${replyRate.toFixed(1)}%`, dms_enviados_7d: dmsSent },
  })
}

export async function alertQuotaFull(dmsSent: number, limit: number): Promise<void> {
  await sendAlert({
    level: 'info',
    title: 'Cuota diaria completa',
    message: `Se alcanzó el límite de DMs por hoy.`,
    meta: { enviados: dmsSent, limite: limit },
  })
}
