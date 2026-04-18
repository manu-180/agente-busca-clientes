import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseServer } from '@/lib/supabase-server'
import { sendDM, SidecarError } from '@/lib/ig/sidecar'
import { SYSTEM_PROMPT } from '@/lib/ig/prompts/system'
import { REPLY_TEMPLATES } from '@/lib/ig/prompts/templates'
import { classifyIntent } from '@/lib/ig/intent'
import { isOwnerTakeover } from '@/lib/ig/owner-takeover'

const CLOSED_STATUSES = new Set([
  'closed_positive',
  'closed_negative',
  'closed_ghosted',
  'owner_takeover',
  'blacklisted',
])

async function sendAndRecord(
  supabase: ReturnType<typeof createSupabaseServer>,
  leadId: string,
  igUsername: string,
  threadId: string,
  text: string,
  metadata: Record<string, unknown> = {},
) {
  try {
    const { message_id } = await sendDM(igUsername, text)
    await supabase.from('instagram_conversations').insert({
      lead_id: leadId,
      ig_thread_id: threadId,
      ig_message_id: message_id,
      role: 'assistant',
      content: text,
      direction: 'outbound',
      sent_at: new Date().toISOString(),
      metadata,
    })
    return true
  } catch (err) {
    if (err instanceof SidecarError && err.isCircuitOpen) {
      console.error('[handle-reply] Circuit open — skipping send')
    } else {
      console.error('[handle-reply] sendDM error', err)
    }
    return false
  }
}

export async function handleIncomingReply(
  leadId: string,
  threadId: string,
  inboundText: string,
): Promise<void> {
  const supabase = createSupabaseServer()

  // Load lead
  const { data: lead } = await supabase
    .from('instagram_leads')
    .select('*')
    .eq('id', leadId)
    .single()

  if (!lead) return

  // Guard: never respond to closed conversations
  if (CLOSED_STATUSES.has(lead.status)) return

  // ── 1. Owner takeover (keyword-based, synchronous) ────────────────
  if (isOwnerTakeover(inboundText)) {
    await supabase.from('instagram_leads').update({
      status: 'owner_takeover',
      owner_takeover_at: new Date().toISOString(),
    }).eq('id', leadId)
    return
  }

  // ── 2. Load last 6 messages as context for intent classifier ──────
  const { data: recentRows } = await supabase
    .from('instagram_conversations')
    .select('role, content')
    .eq('lead_id', leadId)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: false })
    .limit(6)

  const conversationContext = (recentRows ?? [])
    .reverse()
    .map((r) => `[${r.role === 'assistant' ? 'AGENTE' : 'BOUTIQUE'}] ${r.content}`)
    .join('\n')

  // ── 3. Classify intent ─────────────────────────────────────────────
  const { intent, confidence } = await classifyIntent(inboundText, conversationContext)

  // ── 4. Handle owner_takeover from classifier ──────────────────────
  if (intent === 'owner_takeover') {
    await supabase.from('instagram_leads').update({
      status: 'owner_takeover',
      owner_takeover_at: new Date().toISOString(),
    }).eq('id', leadId)
    return
  }

  // ── 5. Handle declined ────────────────────────────────────────────
  if (intent === 'declined') {
    await sendAndRecord(
      supabase,
      leadId,
      lead.ig_username,
      threadId,
      REPLY_TEMPLATES.decline_close,
      { intent, confidence },
    )
    await supabase.from('instagram_leads').update({
      status: 'closed_negative',
      closed_at: new Date().toISOString(),
    }).eq('id', leadId)
    return
  }

  // ── 6. Update lead status for positive intents ────────────────────
  if (intent === 'interested' || intent === 'wants_call' || intent === 'pricing_question' || intent === 'what_includes') {
    if (lead.status !== 'interested') {
      await supabase.from('instagram_leads').update({ status: 'interested' }).eq('id', leadId)
    }
  }

  // ── 7. Build full conversation history for Claude ──────────────────
  const { data: allRows } = await supabase
    .from('instagram_conversations')
    .select('role, content, created_at')
    .eq('lead_id', leadId)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: true })

  const messages: Anthropic.MessageParam[] = (allRows ?? []).map((row) => ({
    role: row.role as 'user' | 'assistant',
    content: row.content,
  }))

  // ── 8. Add intent hint to system for context-aware response ────────
  const intentHint: Record<string, string> = {
    pricing_question: '\n\nNOTA: La persona preguntó por el precio. Recordale que el boceto es gratis y que el costo de implementación lo ven en una llamada rápida.',
    what_includes: '\n\nNOTA: La persona preguntó qué incluye el boceto. Explicá brevemente: diseño de home, sección de productos/catálogo, contacto, adaptado a su estilo.',
    wants_call: '\n\nNOTA: La persona quiere coordinar una llamada. Proponé días y horarios concretos.',
    interested: '\n\nNOTA: La persona muestra interés. El siguiente paso es preguntarle si tiene web actualmente y coordinar el envío del boceto.',
    out_of_scope: '\n\nNOTA: El mensaje está fuera del tema. Decí amablemente que no podés ayudar con eso y redirigí brevemente a la propuesta.',
  }

  const systemWithHint = SYSTEM_PROMPT + (intentHint[intent] ?? '')

  // ── 9. Generate response with Claude ──────────────────────────────
  const anthropic = new Anthropic()
  let responseText: string

  try {
    const completion = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: systemWithHint,
      messages,
    })
    responseText =
      completion.content[0].type === 'text' ? completion.content[0].text.trim() : ''
  } catch (err) {
    console.error('[handle-reply] Claude error', err)
    return
  }

  if (!responseText) return

  // ── 10. Race condition guard before sending ────────────────────────
  const { data: freshLead } = await supabase
    .from('instagram_leads')
    .select('status')
    .eq('id', leadId)
    .single()

  if (!freshLead || CLOSED_STATUSES.has(freshLead.status)) return

  // ── 11. Send and record ────────────────────────────────────────────
  await sendAndRecord(supabase, leadId, lead.ig_username, threadId, responseText, {
    intent,
    confidence,
  })
}
