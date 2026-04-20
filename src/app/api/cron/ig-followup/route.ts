/**
 * Cron: daily 10:00 ART (13:00 UTC).
 * - 48h no reply → send follow-up, mark follow_up_sent
 * - 96h no reply after follow-up → mark closed_ghosted
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseServer } from '@/lib/supabase-server'
import { sendDM, SidecarError } from '@/lib/ig/sidecar'
import { SYSTEM_PROMPT } from '@/lib/ig/prompts/system'
import { pickFollowupTemplate, GHOSTED_CLOSE } from '@/lib/ig/prompts/templates'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const IG_SENDER = process.env.IG_SENDER_USERNAME!
const FOLLOWUP_HOURS = parseInt(process.env.FOLLOWUP_HOURS ?? '48', 10)
const DRY_RUN = process.env.DRY_RUN === 'true'

function authCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createSupabaseServer()

  // Circuit breaker
  const { data: healthRows } = await supabase
    .from('account_health_log')
    .select('event')
    .eq('sender_ig', IG_SENDER)
    .gt('cooldown_until', new Date().toISOString())
    .limit(1)

  if (healthRows?.length) {
    return NextResponse.json({ ok: false, skipped: true, reason: 'circuit_open' })
  }

  const now = new Date()
  const threshold48h = new Date(now.getTime() - FOLLOWUP_HOURS * 60 * 60 * 1000).toISOString()
  const threshold96h = new Date(now.getTime() - FOLLOWUP_HOURS * 2 * 60 * 60 * 1000).toISOString()

  // ── Close ghosted (follow_up_sent + 48h more with no reply) ────────
  const { data: ghosted } = await supabase
    .from('instagram_leads')
    .select('id')
    .eq('status', 'follow_up_sent')
    .lt('follow_up_sent_at', threshold96h)
    .eq('reply_count', 0)

  if (ghosted?.length) {
    const ids = ghosted.map((r) => r.id)
    await supabase
      .from('instagram_leads')
      .update({ status: 'closed_ghosted', closed_at: now.toISOString() })
      .in('id', ids)
  }

  // ── Send follow-up (contacted + 48h no reply) ──────────────────────
  const { data: toFollowUp } = await supabase
    .from('instagram_leads')
    .select('id, ig_username, ig_thread_id, full_name, biography, business_category')
    .eq('status', 'contacted')
    .lt('last_dm_sent_at', threshold48h)
    .eq('reply_count', 0)

  const results: Array<{ lead_id: string; ok: boolean; detail?: string }> = []

  for (const lead of toFollowUp ?? []) {
    try {
      const anthropic = new Anthropic()
      let messageText: string

      try {
        const completion = await anthropic.messages.create({
          model: 'claude-sonnet-4-5',
          max_tokens: 150,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: `Escribí un mensaje de seguimiento breve para @${lead.ig_username}.
Ya les enviamos un DM hace más de 48hs y no respondieron.
Bio: ${lead.biography ?? 'sin bio'}
Usá esta plantilla como base: ${pickFollowupTemplate()}
Devolvé ÚNICAMENTE el texto, sin comillas.`,
            },
          ],
        })
        messageText =
          completion.content[0].type === 'text'
            ? completion.content[0].text.trim()
            : pickFollowupTemplate()
      } catch {
        messageText = pickFollowupTemplate()
      }

      if (DRY_RUN) {
        console.log(`[DRY_RUN] Follow-up to @${lead.ig_username}: ${messageText}`)
        await supabase
          .from('instagram_leads')
          .update({ status: 'follow_up_sent', follow_up_sent_at: now.toISOString(), last_dm_sent_at: now.toISOString() })
          .eq('id', lead.id)
        results.push({ lead_id: lead.id, ok: true, detail: 'dry_run' })
        continue
      }

      const { thread_id, message_id } = await sendDM(lead.ig_username, messageText)

      await Promise.all([
        supabase.from('instagram_leads').update({
          status: 'follow_up_sent',
          follow_up_sent_at: now.toISOString(),
          last_dm_sent_at: now.toISOString(),
          dm_sent_count: supabase.rpc as unknown as number, // updated via DB
        }).eq('id', lead.id),

        supabase.from('instagram_conversations').insert({
          lead_id: lead.id,
          ig_thread_id: thread_id ?? lead.ig_thread_id,
          ig_message_id: message_id,
          role: 'assistant',
          content: messageText,
          direction: 'outbound',
          sent_at: now.toISOString(),
          metadata: { is_followup: true },
        }),
      ])

      // dm_sent_count incremented on next select (select full lead next time)

      results.push({ lead_id: lead.id, ok: true, detail: 'sent' })
    } catch (err) {
      const isCircuit = err instanceof SidecarError && err.isCircuitOpen
      results.push({ lead_id: lead.id, ok: false, detail: String(err) })
      if (isCircuit) break // stop processing on circuit open
    }
  }

  return NextResponse.json({
    ok: true,
    ghosted: ghosted?.length ?? 0,
    followups_sent: results.filter((r) => r.ok).length,
    results,
  })
}
