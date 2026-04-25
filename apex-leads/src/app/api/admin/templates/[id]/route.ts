import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServer } from '@/lib/supabase-server'
import { requireAdmin } from '@/lib/admin/auth'

export const dynamic = 'force-dynamic'

// Valid status transitions
const VALID_STATUSES = ['active', 'paused', 'killed', 'draft'] as const
type TemplateStatus = (typeof VALID_STATUSES)[number]

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const authError = requireAdmin(req)
  if (authError) return authError

  let body: { status?: TemplateStatus; name?: string; content?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  if (body.status && !VALID_STATUSES.includes(body.status)) {
    return NextResponse.json(
      { ok: false, error: `status must be one of: ${VALID_STATUSES.join(', ')}` },
      { status: 400 },
    )
  }

  const allowed = ['status', 'name', 'content']
  const update = Object.fromEntries(
    Object.entries(body).filter(([k]) => allowed.includes(k)),
  )

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: false, error: 'No valid fields to update' }, { status: 400 })
  }

  const supabase = createSupabaseServer()
  const { error } = await supabase.from('dm_templates').update(update).eq('id', params.id)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  revalidatePath('/admin/ig/templates')
  return NextResponse.json({ ok: true })
}
