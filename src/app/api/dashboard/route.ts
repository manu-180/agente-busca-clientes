import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

export async function GET() {
  const supabase = createSupabaseServer()

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const last7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const [
    totalRes,
    contactadosRes,
    respondieronRes,
    interesadosRes,
    cerradosRes,
    recientesRes,
    noReplyEmojiRes,
    noReplyLowSignalRes,
    handoffRes,
    guardrailRes,
  ] =
    await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true })
        .eq('estado', 'contactado').gte('updated_at', today.toISOString()),
      supabase.from('leads').select('id', { count: 'exact', head: true })
        .eq('estado', 'respondio'),
      supabase.from('leads').select('id', { count: 'exact', head: true })
        .eq('estado', 'interesado'),
      supabase.from('leads').select('id', { count: 'exact', head: true })
        .eq('estado', 'cerrado').gte('updated_at', firstOfMonth.toISOString()),
      supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(10),
      supabase.from('conversational_events').select('id', { count: 'exact', head: true })
        .eq('event_name', 'no_reply_emoji').gte('created_at', last7d.toISOString()),
      supabase.from('conversational_events').select('id', { count: 'exact', head: true })
        .eq('event_name', 'no_reply_low_signal').gte('created_at', last7d.toISOString()),
      supabase.from('conversational_events').select('id', { count: 'exact', head: true })
        .eq('event_name', 'handoff_human_sent').gte('created_at', last7d.toISOString()),
      supabase.from('conversational_events').select('id', { count: 'exact', head: true })
        .eq('event_name', 'llm_blocked_guardrail').gte('created_at', last7d.toISOString()),
    ])

  const conversationalMetricsAvailable =
    !noReplyEmojiRes.error &&
    !noReplyLowSignalRes.error &&
    !handoffRes.error &&
    !guardrailRes.error

  return NextResponse.json({
    total_leads: totalRes.count ?? 0,
    contactados_hoy: contactadosRes.count ?? 0,
    respondieron: respondieronRes.count ?? 0,
    interesados: interesadosRes.count ?? 0,
    cerrados_mes: cerradosRes.count ?? 0,
    leads_recientes: recientesRes.data ?? [],
    conversational_metrics_available: conversationalMetricsAvailable,
    no_reply_emoji_7d: noReplyEmojiRes.count ?? 0,
    no_reply_low_signal_7d: noReplyLowSignalRes.count ?? 0,
    handoff_human_7d: handoffRes.count ?? 0,
    guardrail_block_7d: guardrailRes.count ?? 0,
  })
}
