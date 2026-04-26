import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { igConfig } from '@/lib/ig/config'
import { sendDM, enrichProfiles, SidecarError, type ProfileData } from '@/lib/ig/sidecar'
import { isTargetLead, classifyLink } from '@/lib/ig/classify'
import { loadProductionWeights, computeScore, scoreWithShadow, type WeightsRecord } from '@/lib/ig/score/v2'
import { extractFeatures } from '@/lib/ig/score/features'
import { pickTemplate, renderTemplate } from '@/lib/ig/templates/selector'
import { preFilter, loadBlacklist } from '@/lib/ig/discover/pre-filter'
import { classifyNiche, checkDailyCostAlert, NICHE_VALUES, type ClassificationResult } from '@/lib/ig/classify/niche'
import { sendAlert } from '@/lib/ig/alerts/discord'
import { RAMP_START_DATE, getDailyLimit } from '@/lib/ig/ramp-up'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const TARGET_NICHES = new Set<(typeof NICHE_VALUES)[number]>([
  'moda_femenina',
  'moda_masculina',
  'indumentaria_infantil',
  'accesorios',
  'calzado',
  'belleza_estetica',
  'joyeria',
])
const MIN_CONFIDENCE = 0.6

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

  const dryRun = igConfig.DRY_RUN
  const dailyLimit = RAMP_START_DATE
    ? getDailyLimit(Math.max(0, Math.floor((Date.now() - RAMP_START_DATE.getTime()) / 86_400_000)))
    : igConfig.DAILY_DM_LIMIT
  const senderIg = igConfig.IG_SENDER_USERNAME

  const supabase = createSupabaseServer()
  const today = new Date().toISOString().slice(0, 10)

  // Check today's quota
  const { data: quotaRow } = await supabase
    .from('dm_daily_quota')
    .select('dms_sent')
    .eq('sender_ig_username', senderIg)
    .eq('day', today)
    .maybeSingle()

  const sentToday = quotaRow?.dms_sent ?? 0
  const remaining = dailyLimit - sentToday

  if (remaining <= 0) {
    return NextResponse.json({ ok: true, dry_run: dryRun, leads_processed: 0, reason: 'daily_limit_reached' })
  }

  // Fetch unprocessed raw leads
  const { data: rawLeads, error: fetchErr } = await supabase
    .from('instagram_leads_raw')
    .select('id, ig_username, raw_profile, source_ref')
    .eq('processed', false)
    .is('processing_error', null)
    .limit(Math.min(remaining * 2, 30)) // fetch extra to account for filtered-out leads

  if (fetchErr) {
    console.error('[run-cycle] fetch raw leads error', fetchErr)
    return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 })
  }

  if (!rawLeads || rawLeads.length === 0) {
    return NextResponse.json({ ok: true, dry_run: dryRun, leads_processed: 0, reason: 'no_raw_leads' })
  }

  // Check which usernames already exist in instagram_leads to avoid duplicates
  const usernames = rawLeads.map((r) => r.ig_username).filter(Boolean)
  const { data: existing } = await supabase
    .from('instagram_leads')
    .select('ig_username')
    .in('ig_username', usernames)

  const existingSet = new Set((existing ?? []).map((e) => e.ig_username))
  const newLeads = rawLeads.filter((r) => r.ig_username && !existingSet.has(r.ig_username))

  if (newLeads.length === 0) {
    // Mark all as processed (duplicates)
    await supabase
      .from('instagram_leads_raw')
      .update({ processed: true })
      .in('id', rawLeads.map((r) => r.id))
    return NextResponse.json({ ok: true, dry_run: dryRun, leads_processed: 0, reason: 'all_duplicates' })
  }

  // Pre-filter using raw_profile data (fast, no API calls)
  const blacklist = await loadBlacklist(supabase)
  const filterResults = newLeads.map((r) => ({ raw: r, ...preFilter(r as Parameters<typeof preFilter>[0], blacklist) }))
  const candidates = filterResults.filter((x) => x.keep).map((x) => x.raw)
  const skipped = filterResults.filter((x) => !x.keep)

  if (skipped.length > 0) {
    // Group by reason to reduce DB round-trips
    const byReason = new Map<string, string[]>()
    for (const s of skipped) {
      const reason = s.reason ?? 'filtered'
      const group = byReason.get(reason) ?? []
      group.push(s.raw.id)
      byReason.set(reason, group)
    }
    for (const [reason, ids] of Array.from(byReason.entries())) {
      await supabase
        .from('instagram_leads_raw')
        .update({ processed: true, processing_error: reason })
        .in('id', ids)
    }
  }

  // Enrich candidates in batches of 20 via sidecar
  const BATCH = 20
  const enrichedMap = new Map<string, ProfileData>()

  let circuitOpen = false

  for (let i = 0; i < candidates.length && !circuitOpen; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH)
    const batchUsernames = batch.map((r) => r.ig_username as string)

    try {
      const { profiles, errors } = await enrichProfiles(batchUsernames)
      for (const p of profiles) {
        enrichedMap.set(p.ig_username, p)
      }
      // Mark enrichment errors as processed with error
      for (const [uname, errMsg] of Object.entries(errors)) {
        const raw = candidates.find((r) => r.ig_username === uname)
        if (raw) {
          await supabase
            .from('instagram_leads_raw')
            .update({ processed: true, processing_error: errMsg })
            .eq('id', raw.id)
        }
      }
    } catch (err) {
      if (err instanceof SidecarError && err.isCircuitOpen) {
        circuitOpen = true
        console.warn('[run-cycle] circuit open — stopping')
      } else {
        console.error('[run-cycle] enrich batch error', err)
      }
    }
  }

  if (circuitOpen) {
    sendAlert(supabase, 'critical', 'sidecar', 'Circuit breaker open — sidecar blocked IG actions', {}).catch(
      (err) => console.error('[run-cycle] sendAlert circuit_open failed', err),
    )
    return NextResponse.json({ ok: false, error: 'circuit_open', leads_processed: 0 }, { status: 503 })
  }

  // Classify niches for enriched leads that pass the target-lead gate
  const classificationMap = new Map<string, ClassificationResult>()
  for (const [username, profile] of enrichedMap.entries()) {
    if (!isTargetLead(profile)) continue
    try {
      const cls = await classifyNiche(supabase, profile)
      classificationMap.set(username, cls)
    } catch (err) {
      console.error('[run-cycle] classify failed', username, err)
    }
  }

  // Load scoring weights once for the entire cycle
  let weights: WeightsRecord
  try {
    weights = await loadProductionWeights(supabase)
  } catch (err) {
    console.error('[run-cycle] failed to load scoring weights', err)
    return NextResponse.json({ ok: false, error: 'scoring_weights_missing' }, { status: 500 })
  }

  // Score + send DMs
  let dmsSent = 0
  const results: Array<{ ig_username: string; action: string; score?: number }> = []

  for (const raw of candidates) {
    if (dmsSent >= remaining) break

    const username = raw.ig_username as string
    const profile = enrichedMap.get(username)

    if (!profile) {
      // Enrich failed silently — already marked above or skip
      await supabase.from('instagram_leads_raw').update({ processed: true }).eq('id', raw.id)
      continue
    }

    if (!isTargetLead(profile)) {
      await supabase
        .from('instagram_leads_raw')
        .update({ processed: true, processing_error: 'filtered_out' })
        .eq('id', raw.id)

      // Still insert into instagram_leads as blacklisted/disqualified for tracking
      const linkVerdict = classifyLink(profile.external_url ?? profile.bio_links?.[0]?.url ?? null)
      await supabase.from('instagram_leads').upsert({
        ig_user_id: Number(profile.ig_user_id),
        ig_username: profile.ig_username,
        full_name: profile.full_name,
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
        lead_score: 0,
        status: 'discovered',
        discovered_via: 'hashtag',
        discovered_source_ref: raw.source_ref,
      }, { onConflict: 'ig_username', ignoreDuplicates: true })

      results.push({ ig_username: username, action: 'filtered' })
      continue
    }

    // Niche gate — skip if wrong niche or low confidence
    const cls = classificationMap.get(username)
    if (!cls || !TARGET_NICHES.has(cls.niche) || cls.confidence < MIN_CONFIDENCE) {
      await supabase
        .from('instagram_leads_raw')
        .update({ processed: true, processing_error: 'wrong_niche' })
        .eq('id', raw.id)
      const linkVerdict = classifyLink(profile.external_url ?? profile.bio_links?.[0]?.url ?? null)
      await supabase.from('instagram_leads').upsert({
        ig_user_id: Number(profile.ig_user_id),
        ig_username: profile.ig_username,
        full_name: profile.full_name,
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
        niche: cls?.niche ?? null,
        niche_confidence: cls?.confidence ?? null,
        lead_score: 0,
        status: 'discovered',
        discovered_via: 'hashtag',
        discovered_source_ref: raw.source_ref,
      }, { onConflict: 'ig_username', ignoreDuplicates: true })
      results.push({ ig_username: username, action: 'wrong_niche', score: 0 })
      continue
    }

    const linkVerdict = classifyLink(profile.external_url ?? profile.bio_links?.[0]?.url ?? null)
    const features = extractFeatures(profile, cls, linkVerdict)
    const { score } = computeScore(features, weights.weights)
    void scoreWithShadow(supabase, features, score)

    if (score < igConfig.MIN_SCORE_FOR_DM) {
      await supabase.from('instagram_leads_raw').update({ processed: true }).eq('id', raw.id)
      await supabase.from('instagram_leads').upsert({
        ig_user_id: Number(profile.ig_user_id),
        ig_username: profile.ig_username,
        full_name: profile.full_name,
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
        niche: cls.niche,
        niche_confidence: cls.confidence,
        lead_score: score,
        scoring_version: weights.version,
        status: 'discovered',
        discovered_via: 'hashtag',
        discovered_source_ref: raw.source_ref,
      }, { onConflict: 'ig_username', ignoreDuplicates: true })

      results.push({ ig_username: username, action: 'low_score', score })
      continue
    }

    // ── Send DM ──────────────────────────────────────────────────────
    const template = await pickTemplate(supabase)
    const firstName = (profile.full_name ?? profile.ig_username ?? '').split(' ')[0] || (profile.ig_username ?? '')
    const dmText = renderTemplate(template, {
      first_name: firstName,
      niche: cls.niche.replaceAll('_', ' '),
    })

    if (dryRun) {
      console.log(`[run-cycle][DRY_RUN] @${username} template=${template.name}: ${dmText.slice(0, 80)}...`)
      await supabase.from('instagram_leads_raw').update({ processed: true }).eq('id', raw.id)
      results.push({ ig_username: username, action: 'dry_run', score })
      dmsSent++
      continue
    }

    try {
      const dmResult = await sendDM(username, dmText)
      const now = new Date().toISOString()

      // Insert/update instagram_leads
      const { data: leadRow } = await supabase
        .from('instagram_leads')
        .upsert({
          ig_user_id: Number(profile.ig_user_id),
          ig_username: profile.ig_username,
          full_name: profile.full_name,
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
          niche: cls.niche,
          niche_confidence: cls.confidence,
          lead_score: score,
          scoring_version: weights.version,
          status: 'contacted',
          ig_thread_id: dmResult.thread_id,
          contacted_at: now,
          last_dm_sent_at: now,
          dm_sent_count: 1,
          template_id: template.id,
          discovered_via: 'hashtag',
          discovered_source_ref: raw.source_ref,
        }, { onConflict: 'ig_username' })
        .select('id')
        .single()

      // Log conversation and score history
      if (leadRow?.id) {
        await supabase.from('instagram_conversations').insert({
          lead_id: leadRow.id,
          ig_thread_id: dmResult.thread_id,
          ig_message_id: dmResult.message_id,
          role: 'assistant',
          content: dmText,
          direction: 'outbound',
          sent_at: now,
        })
        await supabase.from('lead_score_history').insert({
          lead_id: leadRow.id,
          weights_version: weights.version,
          score,
          features,
        })
        await supabase.from('dm_template_assignments').insert({
          lead_id: leadRow.id,
          template_id: template.id,
          sent_at: now,
        })
      }

      // Update quota
      await supabase.from('dm_daily_quota').upsert({
        sender_ig_username: senderIg,
        day: today,
        dms_sent: sentToday + dmsSent + 1,
        last_sent_at: now,
      }, { onConflict: 'sender_ig_username,day' })

      await supabase.from('instagram_leads_raw').update({ processed: true }).eq('id', raw.id)

      results.push({ ig_username: username, action: 'dm_sent', score })
      dmsSent++
      console.log(`[run-cycle] DM sent to @${username} (score: ${score}, thread: ${dmResult.thread_id})`)
    } catch (err) {
      if (err instanceof SidecarError && err.isCircuitOpen) {
        console.warn('[run-cycle] circuit open mid-send — stopping')
        sendAlert(supabase, 'critical', 'sidecar', 'Circuit breaker open mid-send — DM loop halted', {
          last_username: username,
        }).catch((e) => console.error('[run-cycle] sendAlert failed', e))
        break
      }
      console.error(`[run-cycle] DM failed for @${username}`, err)
      await supabase
        .from('instagram_leads_raw')
        .update({ processing_error: String(err) })
        .eq('id', raw.id)
      results.push({ ig_username: username, action: 'error' })
    }
  }

  // Cost guard — fire-and-forget, never throw
  checkDailyCostAlert(supabase).catch((err) => console.error('[run-cycle] cost alert check failed', err))

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    leads_processed: results.length,
    dms_sent: dmsSent,
    results,
  })
}
