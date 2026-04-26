import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { sendAlert } from '@/lib/ig/alerts/discord'
import { findTemplatesToPause, type TemplateStat } from '@/lib/ig/templates/auto-pause'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createSupabaseServer()
  const { data: stats, error } = await supabase
    .from('dm_template_stats')
    .select('template_id, name, status, sends, replies, beta_alpha, beta_beta')
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  const toPause = findTemplatesToPause((stats ?? []) as TemplateStat[])
  const paused: string[] = []

  for (const templateId of toPause) {
    const stat = (stats ?? []).find((t: TemplateStat) => t.template_id === templateId)
    const { error: e } = await supabase.from('dm_templates').update({ status: 'paused' }).eq('id', templateId)
    if (!e) {
      paused.push(templateId)
      if (stat) {
        sendAlert(supabase, 'info', 'templates',
          `Auto-paused "${stat.name}" (CTR dominated — hi < best lo)`,
          { template_id: templateId, sends: stat.sends, replies: stat.replies },
        ).catch((err) => console.error('[auto-pause] alert failed', err))
      }
    }
  }

  return NextResponse.json({ ok: true, evaluated: (stats ?? []).length, paused })
}
