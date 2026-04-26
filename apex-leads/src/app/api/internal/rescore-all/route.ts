/**
 * POST /api/internal/rescore-all
 *
 * Backfill endpoint: re-scores all existing leads using the current production
 * weights and appends rows to lead_score_history for audit.
 * Does NOT overwrite lead_score in instagram_leads (use a manual query for that).
 *
 * Auth: Bearer CRON_SECRET
 * Body (optional): { limit?: number, offset?: number }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { classifyLink } from '@/lib/ig/classify'
import { loadProductionWeights, computeScore } from '@/lib/ig/score/v2'
import { extractFeatures } from '@/lib/ig/score/features'
import type { ProfileData } from '@/lib/ig/sidecar'
import type { ClassificationResult } from '@/lib/ig/classify/niche'
import { NICHE_VALUES } from '@/lib/ig/classify/niche'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const PAGE_SIZE = 100

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!cronSecret || token !== cronSecret) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const limit: number = Math.min(Number(body?.limit ?? PAGE_SIZE), 500)
  const offset: number = Number(body?.offset ?? 0)

  const supabase = createSupabaseServer()

  // Load production weights once
  let weights: Awaited<ReturnType<typeof loadProductionWeights>>
  try {
    weights = await loadProductionWeights(supabase)
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'no production weights — seed scoring_weights first' },
      { status: 500 },
    )
  }

  // Fetch leads page
  const { data: leads, error } = await supabase
    .from('instagram_leads')
    .select(
      'id, ig_username, biography, external_url, bio_links, followers_count, following_count, posts_count, is_private, is_verified, is_business, business_category, profile_pic_url, last_post_at, niche, niche_confidence, link_verdict',
    )
    .range(offset, offset + limit - 1)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  if (!leads || leads.length === 0) {
    return NextResponse.json({ ok: true, rescored: 0, offset, note: 'no leads in range' })
  }

  // Build history rows
  const historyRows: Array<{
    lead_id: string
    weights_version: number
    score: number
    features: Record<string, number>
  }> = []

  for (const lead of leads) {
    // Reconstruct a partial ProfileData from stored columns
    const profile: ProfileData = {
      ig_user_id: lead.id,      // uuid used as placeholder — not stored as int here
      ig_username: lead.ig_username ?? '',
      full_name: null,
      biography: lead.biography ?? null,
      external_url: lead.external_url ?? null,
      bio_links: (lead.bio_links as ProfileData['bio_links']) ?? [],
      followers_count: lead.followers_count ?? 0,
      following_count: lead.following_count ?? 0,
      posts_count: lead.posts_count ?? 0,
      is_private: lead.is_private ?? false,
      is_verified: lead.is_verified ?? false,
      is_business: lead.is_business ?? false,
      business_category: lead.business_category ?? null,
      profile_pic_url: lead.profile_pic_url ?? null,
      last_post_at: lead.last_post_at ?? null,
    }

    // Reconstruct niche result from stored columns
    const niche: ClassificationResult | null =
      lead.niche && NICHE_VALUES.includes(lead.niche as (typeof NICHE_VALUES)[number])
        ? {
            niche: lead.niche as ClassificationResult['niche'],
            confidence: lead.niche_confidence ?? 0,
            reason: 'stored',
          }
        : null

    // Use stored link_verdict if available, else recompute
    const linkVerdict: string =
      (lead.link_verdict as string) ??
      classifyLink(lead.external_url ?? (lead.bio_links as Array<{ url: string }>)?.[0]?.url ?? null)

    const features = extractFeatures(profile, niche, linkVerdict)
    const { score } = computeScore(features, weights.weights)

    historyRows.push({
      lead_id: lead.id,
      weights_version: weights.version,
      score,
      features: features as unknown as Record<string, number>,
    })
  }

  // Batch-insert into lead_score_history
  const { error: insertError } = await supabase.from('lead_score_history').insert(historyRows)
  if (insertError) {
    return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    rescored: historyRows.length,
    weights_version: weights.version,
    offset,
    next_offset: offset + historyRows.length,
    has_more: historyRows.length === limit,
  })
}
