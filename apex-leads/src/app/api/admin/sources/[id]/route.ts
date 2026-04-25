import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServer } from '@/lib/supabase-server'
import { requireAdmin } from '@/lib/admin/auth'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const authError = requireAdmin(req)
  if (authError) return authError

  let body: { active?: boolean; priority?: number; schedule_cron?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const allowed = ['active', 'priority', 'schedule_cron']
  const update = Object.fromEntries(
    Object.entries(body).filter(([k]) => allowed.includes(k)),
  )

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: false, error: 'No valid fields to update' }, { status: 400 })
  }

  const supabase = createSupabaseServer()
  const { error } = await supabase.from('discovery_sources').update(update).eq('id', params.id)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  revalidatePath('/admin/ig/sources')
  return NextResponse.json({ ok: true })
}
