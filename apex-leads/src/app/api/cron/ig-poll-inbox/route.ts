/**
 * Cron: every 2 minutes.
 * Polls sidecar for unread inbox messages, deduplicates by ig_message_id,
 * and triggers handleIncomingReply for each new inbound message.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { pollInbox } from '@/lib/ig/sidecar'
import { handleIncomingReply } from '@/lib/ig/handle-reply'
import { alertLowReplyRate } from '@/lib/ig/alerts'
import { igConfig } from '@/lib/ig/config'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authCron(req: NextRequest): boolean {
  return req.headers.get('authorization') === `Bearer ${igConfig.CRON_SECRET}`
}

export async function GET(req: NextRequest) {
  if (!authCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createSupabaseServer()

  // Use a since_ts from 10 minutes ago to catch any missed messages
  const since_ts = (Date.now() - 10 * 60 * 1000) / 1000

  let messages: Awaited<ReturnType<typeof pollInbox>>['messages']
  try {
    const result = await pollInbox(since_ts)
    messages = result.messages
  } catch (err) {
    console.error('[ig-poll-inbox] sidecar error', err)
    return NextResponse.json({ ok: false, error: String(err) })
  }

  // Check reply rate every ~30 polls (~1h) to avoid alert spam
  if (Math.random() < 0.033) {
    const ago7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: sentRows } = await supabase
      .from('instagram_leads')
      .select('reply_count')
      .gte('contacted_at', ago7d)
    if (sentRows && sentRows.length >= 10) {
      const replied = sentRows.filter((r) => (r.reply_count ?? 0) > 0).length
      const rate = (replied / sentRows.length) * 100
      if (rate < 5) {
        await alertLowReplyRate(rate, sentRows.length).catch(() => null)
      }
    }
  }

  if (!messages.length) {
    return NextResponse.json({ ok: true, new_messages: 0 })
  }

  const processed: Array<{ message_id: string; handled: boolean; reason?: string }> = []

  for (const msg of messages) {
    // Skip outbound (our own messages)
    if (msg.is_outbound) continue

    // Idempotency check — skip if already recorded
    const { data: existing } = await supabase
      .from('instagram_conversations')
      .select('id')
      .eq('ig_message_id', msg.message_id)
      .maybeSingle()

    if (existing) {
      processed.push({ message_id: msg.message_id, handled: false, reason: 'duplicate' })
      continue
    }

    // Find lead by thread_id or ig_username
    const { data: lead } = await supabase
      .from('instagram_leads')
      .select('id, status, reply_count, template_id, replied_at')
      .or(`ig_thread_id.eq.${msg.thread_id},ig_username.eq.${msg.ig_username}`)
      .maybeSingle()

    if (!lead) {
      // Unknown sender — ignore
      processed.push({ message_id: msg.message_id, handled: false, reason: 'unknown_sender' })
      continue
    }

    // Skip if conversation is already closed
    const closedStatuses = ['closed_positive', 'closed_negative', 'closed_ghosted', 'blacklisted']
    if (closedStatuses.includes(lead.status)) {
      processed.push({ message_id: msg.message_id, handled: false, reason: 'conversation_closed' })
      continue
    }

    // Record inbound message
    await supabase.from('instagram_conversations').insert({
      lead_id: lead.id,
      ig_thread_id: msg.thread_id,
      ig_message_id: msg.message_id,
      role: 'user',
      content: msg.text,
      direction: 'inbound',
      sent_at: new Date(msg.timestamp * 1000).toISOString(),
    })

    // Update lead reply stats
    const replyTs = new Date(msg.timestamp * 1000).toISOString()
    await supabase.from('instagram_leads').update({
      reply_count: (lead.reply_count ?? 0) + 1,
      last_reply_at: replyTs,
      ig_thread_id: msg.thread_id,
      status: lead.status === 'contacted' || lead.status === 'follow_up_sent' ? 'replied' : lead.status,
    }).eq('id', lead.id)

    // Mark assignment replied (first reply only)
    if (lead.template_id && !lead.replied_at) {
      await supabase
        .from('dm_template_assignments')
        .update({ replied: true, replied_at: replyTs, reply_was_positive: true })
        .eq('lead_id', lead.id)
        .eq('replied', false)

      await supabase
        .from('instagram_leads')
        .update({ replied_at: replyTs })
        .eq('id', lead.id)
    }

    // Trigger Claude response
    try {
      await handleIncomingReply(lead.id, msg.thread_id, msg.text)
      processed.push({ message_id: msg.message_id, handled: true })
    } catch (err) {
      console.error('[ig-poll-inbox] handleReply error', err)
      processed.push({ message_id: msg.message_id, handled: false, reason: String(err) })
    }
  }

  return NextResponse.json({
    ok: true,
    new_messages: processed.filter((p) => p.handled).length,
    processed,
  })
}
