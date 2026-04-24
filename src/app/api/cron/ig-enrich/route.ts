/**
 * Cron: hourly (at :07).
 * Picks up to 20 unprocessed raw profiles, enriches via sidecar,
 * runs classify + score, and upserts into instagram_leads.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { classifyLink, isTargetLead } from '@/lib/ig/classify'
import { scoreLead } from '@/lib/ig/score'
import { enrichProfiles, type ProfileData } from '@/lib/ig/sidecar'
import { igConfig } from '@/lib/ig/config'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const BATCH_SIZE = 20

function authCron(req: NextRequest): boolean {
  return req.headers.get('authorization') === `Bearer ${igConfig.CRON_SECRET}`
}

export async function GET(req: NextRequest) {
  if (!authCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createSupabaseServer()

  // Take next unprocessed batch
  const { data: rawRows, error: rawErr } = await supabase
    .from('instagram_leads_raw')
    .select('id, ig_username, raw_profile, source, source_ref')
    .eq('processed', false)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (rawErr || !rawRows?.length) {
    return NextResponse.json({ ok: true, processed: 0, reason: rawErr?.message ?? 'no rows' })
  }

  const usernames = rawRows.map((r) => r.ig_username).filter(Boolean) as string[]

  // Enrich via sidecar (falls back to raw_profile data if sidecar unavailable)
  let enrichedMap: Record<string, ProfileData> = {}
  try {
    const { profiles } = await enrichProfiles(usernames)
    for (const p of profiles) enrichedMap[p.ig_username] = p
  } catch {
    // Sidecar unavailable — use Apify raw data directly
  }

  const results = { qualified: 0, skipped: 0, errors: 0 }

  for (const row of rawRows) {
    try {
      const username = row.ig_username
      const raw = row.raw_profile as Record<string, unknown>

      // Build profile from enriched data or fall back to Apify raw
      const enriched = enrichedMap[username]
      const profile = {
        ig_username: username,
        biography: enriched?.biography ?? (raw.biography as string) ?? null,
        external_url: enriched?.external_url ?? (raw.externalUrl as string) ?? null,
        bio_links: enriched?.bio_links ?? [],
        followers_count:
          enriched?.followers_count ?? (raw.followersCount as number) ?? 0,
        following_count:
          enriched?.following_count ?? (raw.followingCount as number) ?? 0,
        posts_count: enriched?.posts_count ?? (raw.postsCount as number) ?? 0,
        is_private: enriched?.is_private ?? (raw.isPrivate as boolean) ?? false,
        is_verified: enriched?.is_verified ?? (raw.verified as boolean) ?? false,
        is_business: enriched?.is_business ?? (raw.isBusinessAccount as boolean) ?? false,
        business_category:
          enriched?.business_category ?? (raw.businessCategoryName as string) ?? null,
        profile_pic_url: enriched?.profile_pic_url ?? (raw.profilePicUrl as string) ?? null,
        last_post_at: enriched?.last_post_at ?? null,
        posts_last_30d: 0,
      }

      const primaryUrl = profile.external_url ?? (profile.bio_links[0]?.url ?? null)
      const linkVerdict = classifyLink(primaryUrl)
      const qualified = isTargetLead(profile)

      if (qualified) {
        const { score, breakdown } = scoreLead(profile)
        const igUserId =
          enriched?.ig_user_id ?? (raw.id as string) ?? (raw.userId as string) ?? username

        const { error: upsertErr } = await supabase
          .from('instagram_leads')
          .upsert(
            {
              ig_user_id: igUserId,
              ig_username: username,
              full_name: enriched?.full_name ?? (raw.fullName as string) ?? null,
              biography: profile.biography,
              external_url: profile.external_url,
              bio_links: profile.bio_links,
              link_verdict: linkVerdict,
              followers_count: profile.followers_count,
              following_count: profile.following_count,
              posts_count: profile.posts_count,
              is_private: profile.is_private,
              is_verified: profile.is_verified,
              is_business: profile.is_business,
              business_category: profile.business_category,
              profile_pic_url: profile.profile_pic_url,
              last_post_at: profile.last_post_at,
              posts_last_30d: 0,
              lead_score: score,
              score_breakdown: breakdown,
              status: 'qualified',
              discovered_via: row.source,
              discovered_source_ref: row.source_ref,
            },
            { onConflict: 'ig_user_id', ignoreDuplicates: false },
          )

        if (upsertErr) {
          console.error('[ig-enrich] upsert error', username, upsertErr.message)
          results.errors++
        } else {
          results.qualified++
        }
      } else {
        results.skipped++
      }

      // Mark raw row as processed
      await supabase
        .from('instagram_leads_raw')
        .update({ processed: true })
        .eq('id', row.id)
    } catch (err) {
      console.error('[ig-enrich] row error', row.ig_username, err)
      await supabase
        .from('instagram_leads_raw')
        .update({ processed: true, processing_error: String(err) })
        .eq('id', row.id)
      results.errors++
    }
  }

  return NextResponse.json({ ok: true, ...results })
}
