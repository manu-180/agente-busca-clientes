import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { classifyNiche } from '@/lib/ig/classify/niche'

export const dynamic = 'force-dynamic'

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (token !== cronSecret) {
    return unauthorized()
  }

  let body: { ig_username?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const { ig_username } = body
  if (!ig_username || typeof ig_username !== 'string') {
    return NextResponse.json({ ok: false, error: 'ig_username required' }, { status: 400 })
  }

  const supabase = createSupabaseServer()

  const { data: lead, error: fetchErr } = await supabase
    .from('instagram_leads')
    .select('ig_username, full_name, biography, external_url, bio_links, followers_count, following_count, posts_count, is_private, is_verified, is_business, business_category, profile_pic_url, last_post_at')
    .eq('ig_username', ig_username)
    .maybeSingle()

  if (fetchErr) {
    return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 })
  }

  if (!lead) {
    return NextResponse.json({ ok: false, error: `Lead @${ig_username} not found in instagram_leads` }, { status: 404 })
  }

  // Build a ProfileData-compatible shape from the lead row
  const profile = {
    ig_user_id: '',
    ig_username: lead.ig_username,
    full_name: lead.full_name,
    biography: lead.biography,
    external_url: lead.external_url,
    bio_links: (lead.bio_links as Array<{ url: string; title?: string }>) ?? [],
    followers_count: lead.followers_count ?? 0,
    following_count: lead.following_count ?? 0,
    posts_count: lead.posts_count ?? 0,
    is_private: lead.is_private ?? false,
    is_verified: lead.is_verified ?? false,
    is_business: lead.is_business ?? false,
    business_category: lead.business_category,
    profile_pic_url: lead.profile_pic_url,
    last_post_at: lead.last_post_at,
  }

  try {
    const result = await classifyNiche(supabase, profile)
    return NextResponse.json({ ok: true, ig_username, result })
  } catch (err) {
    console.error('[classify-niche] error', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
