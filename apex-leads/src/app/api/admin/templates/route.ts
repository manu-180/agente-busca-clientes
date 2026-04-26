import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServer } from '@/lib/supabase-server'
import { requireAdmin } from '@/lib/admin/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const authError = requireAdmin(req)
  if (authError) return authError

  let body: { name?: string; body?: string; variables?: string[]; notes?: string }
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.name?.trim()) return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 })
  if (!body.body?.trim()) return NextResponse.json({ ok: false, error: 'body required' }, { status: 400 })

  const supabase = createSupabaseServer()
  const { data, error } = await supabase
    .from('dm_templates')
    .insert({ name: body.name.trim(), body: body.body.trim(), variables: body.variables ?? [], notes: body.notes?.trim() ?? null, status: 'draft' })
    .select('id').single()

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  revalidatePath('/admin/ig/templates')
  return NextResponse.json({ ok: true, id: data.id }, { status: 201 })
}
