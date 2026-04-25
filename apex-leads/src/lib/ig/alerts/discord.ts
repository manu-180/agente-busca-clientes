import { igConfig } from '../config'

export type AlertSeverity = 'info' | 'warning' | 'critical'

const COLORS: Record<AlertSeverity, number> = {
  info: 0x3b82f6,
  warning: 0xf59e0b,
  critical: 0xef4444,
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sendAlert(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  severity: AlertSeverity,
  source: string,
  message: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  // Always persist in DB
  await supabase.from('alerts_log').insert({ severity, source, message, metadata: meta })

  const url = igConfig.DISCORD_ALERT_WEBHOOK
  if (!url) return

  // Dedup: skip if same (severity, source, message) sent in the last hour
  const since = new Date(Date.now() - 3_600_000).toISOString()
  const { count } = await supabase
    .from('alerts_log')
    .select('*', { count: 'exact', head: true })
    .eq('severity', severity)
    .eq('source', source)
    .eq('message', message)
    .gte('triggered_at', since)

  if ((count ?? 0) > 1) return

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [
        {
          title: `[${severity.toUpperCase()}] ${source}`,
          description: message,
          color: COLORS[severity],
          fields: Object.entries(meta)
            .slice(0, 10)
            .map(([k, v]) => ({ name: k, value: String(v).slice(0, 200), inline: true })),
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  }).catch((err) => console.error('[discord] send failed', err))
}
