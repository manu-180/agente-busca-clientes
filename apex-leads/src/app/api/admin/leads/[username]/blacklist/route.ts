import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServer } from '@/lib/supabase-server'
import { requireAdmin } from '@/lib/admin/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { username: string } }) {
  const authError = requireAdmin(req)
  if (authError) return authError

  let reason = 'manual_admin'
  try {
    const body = await req.json()
    if (body.reason) reason = String(body.reason).slice(0, 200)
  } catch {
    // reason stays default
  }

  const supabase = createSupabaseServer()

  // Add to blacklist (ignore if already exists)
  const { error: blError } = await supabase
    .from('lead_blacklist')
    .upsert({ ig_username: params.username, reason }, { onConflict: 'ig_username', ignoreDuplicates: true })

  if (blError) {
    return NextResponse.json({ ok: false, error: blError.message }, { status: 500 })
  }

  // Update lead status to blacklisted
  await supabase
    .from('instagram_leads')
    .update({ status: 'blacklisted', updated_at: new Date().toISOString() })
    .eq('ig_username', params.username)

  revalidatePath('/admin/ig/leads')
  return NextResponse.json({ ok: true })
}
