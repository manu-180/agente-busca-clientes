/**
 * Cron: every 2 minutes.
 * Takes the next due DM from dm_queue, builds the opening message via Claude,
 * sends it through the sidecar, and records everything.
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseServer } from '@/lib/supabase-server'
import { sendDM, SidecarError } from '@/lib/ig/sidecar'
import { SYSTEM_PROMPT } from '@/lib/ig/prompts/system'
import { pickOpeningTemplate } from '@/lib/ig/prompts/templates'
import { alertCircuitOpen } from '@/lib/ig/alerts'
import { ANTHROPIC_CHAT_MODEL } from '@/lib/anthropic-model'
import { igConfig } from '@/lib/ig/config'

export const dynamic = 'force-dynamic'
export const maxDuration = 90

const IG_SENDER = igConfig.IG_SENDER_USERNAME
const DRY_RUN = igConfig.DRY_RUN

function authCron(req: NextRequest): boolean {
  return req.headers.get('authorization') === `Bearer ${igConfig.CRON_SECRET}`
}

export async function GET(req: NextRequest) {
  if (!authCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createSupabaseServer()

  // Circuit breaker check
  const { data: healthRows } = await supabase
    .from('account_health_log')
    .select('event, cooldown_until')
    .eq('sender_ig', IG_SENDER)
    .gt('cooldown_until', new Date().toISOString())
    .limit(1)

  if (healthRows?.length) {
    return NextResponse.json({ ok: false, skipped: true, reason: 'circuit_open' })
  }

  // Get next due queue item (one at a time)
  const { data: queueItem, error: qErr } = await supabase
    .from('dm_queue')
    .select('id, lead_id, attempts')
    .lte('scheduled_at', new Date().toISOString())
    .is('sent_at', null)
    .order('scheduled_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (qErr || !queueItem) {
    return NextResponse.json({ ok: true, sent: 0, reason: 'no pending items' })
  }

  // Load lead
  const { data: lead, error: leadErr } = await supabase
    .from('instagram_leads')
    .select('*')
    .eq('id', queueItem.lead_id)
    .single()

  if (leadErr || !lead) {
    await supabase.from('dm_queue').update({ sent_at: new Date().toISOString(), error: 'lead_not_found' }).eq('id', queueItem.id)
    return NextResponse.json({ ok: false, error: 'lead_not_found' })
  }

  // Skip if lead was already contacted (race condition guard)
  if (!['queued', 'qualified'].includes(lead.status)) {
    await supabase.from('dm_queue').update({ sent_at: new Date().toISOString(), error: 'already_contacted' }).eq('id', queueItem.id)
    return NextResponse.json({ ok: true, skipped: true, reason: 'already_contacted' })
  }

  // Build opening message with Claude
  const anthropic = new Anthropic()
  let messageText: string

  try {
    const template = pickOpeningTemplate(lead)
    const completion = await anthropic.messages.create({
      model: ANTHROPIC_CHAT_MODEL,
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Escribí el primer DM para esta cuenta de Instagram.\n\nPerfil:\n- Usuario: @${lead.ig_username}\n- Nombre: ${lead.full_name ?? 'desconocido'}\n- Biografía: ${lead.biography ?? 'sin bio'}\n- Categoría: ${lead.business_category ?? 'no especificada'}\n\nUsá esta plantilla como base (podés adaptarla levemente para que suene natural):\n${template}\n\nDevolvé ÚNICAMENTE el texto del mensaje, sin comillas ni explicaciones.`,
        },
      ],
    })

    messageText =
      completion.content[0].type === 'text' ? completion.content[0].text.trim() : template
  } catch (err) {
    console.error('[ig-send-pending] Claude error', err)
    messageText = pickOpeningTemplate(lead)
  }

  // Send via sidecar
  if (DRY_RUN) {
    console.log(`[DRY_RUN] Would send DM to @${lead.ig_username}: ${messageText}`)
    await supabase.from('dm_queue').update({ sent_at: new Date().toISOString() }).eq('id', queueItem.id)
    return NextResponse.json({ ok: true, dry_run: true, username: lead.ig_username, text: messageText })
  }

  let threadId: string
  let messageId: string

  try {
    const result = await sendDM(lead.ig_username, messageText)
    threadId = result.thread_id
    messageId = result.message_id
  } catch (err) {
    const isCircuit = err instanceof SidecarError && err.isCircuitOpen
    await supabase.from('dm_queue').update({
      attempts: queueItem.attempts + 1,
      error: String(err),
    }).eq('id', queueItem.id)

    if (isCircuit) {
      const cooldownUntil = err instanceof SidecarError
        ? JSON.parse(err.detail || '{}')?.cooldown_until ?? 'desconocido'
        : 'desconocido'
      await alertCircuitOpen('sidecar_circuit_open', cooldownUntil).catch(() => null)
      return NextResponse.json({ ok: false, error: 'circuit_open_sidecar' }, { status: 503 })
    }
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }

  const now = new Date().toISOString()
  const today = now.split('T')[0]

  const { data: quotaRow } = await supabase
    .from('dm_daily_quota')
    .select('dms_sent')
    .eq('sender_ig_username', IG_SENDER)
    .eq('day', today)
    .maybeSingle()
  const dmsSentSoFar = quotaRow?.dms_sent ?? 0

  // Record everything in parallel
  await Promise.all([
    // Mark queue item sent
    supabase.from('dm_queue').update({ sent_at: now }).eq('id', queueItem.id),

    // Update lead
    supabase.from('instagram_leads').update({
      status: 'contacted',
      ig_thread_id: threadId,
      contacted_at: now,
      last_dm_sent_at: now,
      dm_sent_count: (lead.dm_sent_count ?? 0) + 1,
    }).eq('id', lead.id),

    // Store conversation message
    supabase.from('instagram_conversations').insert({
      lead_id: lead.id,
      ig_thread_id: threadId,
      ig_message_id: messageId,
      role: 'assistant',
      content: messageText,
      direction: 'outbound',
      sent_at: now,
    }),

    // Increment daily quota (upsert with raw SQL via update)
    supabase.from('dm_daily_quota').upsert({
      sender_ig_username: IG_SENDER,
      day: today,
      dms_sent: dmsSentSoFar + 1,
      last_sent_at: now,
    }, { onConflict: 'sender_ig_username,day' }),
  ])

  return NextResponse.json({ ok: true, sent: 1, username: lead.ig_username, thread_id: threadId })
}
