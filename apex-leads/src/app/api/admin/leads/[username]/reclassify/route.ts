import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServer } from '@/lib/supabase-server'
import { requireAdmin } from '@/lib/admin/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { username: string } }) {
  const authError = requireAdmin(req)
  if (authError) return authError

  const supabase = createSupabaseServer()

  // Delete cached classification so next run-cycle re-classifies
  const { error: cacheError } = await supabase
    .from('niche_classifications')
    .delete()
    .eq('ig_username', params.username)

  if (cacheError) {
    return NextResponse.json({ ok: false, error: cacheError.message }, { status: 500 })
  }

  // Reset niche fields — run-cycle will re-populate on next pass
  await supabase
    .from('instagram_leads')
    .update({
      niche: null,
      niche_confidence: null,
      status: 'discovered',
      updated_at: new Date().toISOString(),
    })
    .eq('ig_username', params.username)

  revalidatePath('/admin/ig/leads')
  return NextResponse.json({ ok: true })
}
