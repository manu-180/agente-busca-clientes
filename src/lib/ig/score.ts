import { classifyLink, type IgProfile } from './classify'
import { hasWhatsAppSignal } from './detect_whatsapp'

export interface ScoreBreakdown {
  followers: number
  recency: number
  posting_frequency: number
  business_category: number
  bio_keywords: number
  whatsapp_signals: number
  link_verdict: number
  total: number
}

const TARGET_BUSINESS_CATEGORIES = [
  'clothing store',
  'boutique',
  "women's clothing store",
  'fashion designer',
  'tienda de ropa',
  'moda',
  'indumentaria',
  'ropa',
  'shop',
]

const POSITIVE_BIO_KEYWORDS = [
  /boutique/i,
  /ropa\s+de\s+mujer/i,
  /indumentaria\s+femenina/i,
  /moda\s+femenina/i,
  /\btienda\b/i,
  /showroom/i,
  /env[íi]os/i,
  /\bcolección\b/i,
  /\bcolecci[oó]n\b/i,
  /nueva\s+colecci[oó]n/i,
  /ropa\s+dise[nñ]o/i,
  /\bfashion\b/i,
  /\bstyle\b/i,
]

const NEGATIVE_BIO_KEYWORDS = [
  /mayorist[ao]/i,
  /revende/i,
  /distribuid/i,
  /influencer/i,
  /\bcoach\b/i,
  /\bmentor\b/i,
  /multinivel/i,
  /network\s+marketing/i,
]

export function scoreLead(profile: IgProfile): { score: number; breakdown: ScoreBreakdown } {
  const breakdown: ScoreBreakdown = {
    followers: 0,
    recency: 0,
    posting_frequency: 0,
    business_category: 0,
    bio_keywords: 0,
    whatsapp_signals: 0,
    link_verdict: 0,
    total: 0,
  }

  const followers = profile.followers_count ?? 0
  const bio = profile.biography ?? ''
  const category = (profile.business_category ?? '').toLowerCase()

  // ── Followers (0–25 pts) ──────────────────────────────────────────
  // Sweet spot: 300–20k. Peak at ~5k.
  if (followers >= 300 && followers <= 20_000) {
    if (followers <= 5_000) {
      breakdown.followers = Math.round((followers / 5_000) * 25)
    } else {
      // Slight decay after 5k
      breakdown.followers = Math.round(25 - ((followers - 5_000) / 15_000) * 10)
    }
  } else if (followers > 20_000 && followers <= 50_000) {
    breakdown.followers = 5 // still possible, lower score
  }

  // ── Recency — last post (0–20 pts) ───────────────────────────────
  if (profile.last_post_at) {
    const daysSince =
      (Date.now() - new Date(profile.last_post_at).getTime()) / (1000 * 60 * 60 * 24)
    if (daysSince <= 7) breakdown.recency = 20
    else if (daysSince <= 14) breakdown.recency = 15
    else if (daysSince <= 30) breakdown.recency = 10
    else if (daysSince <= 60) breakdown.recency = 5
  }

  // ── Posting frequency last 30d (0–15 pts) ────────────────────────
  const posts30d = profile.posts_last_30d ?? 0
  if (posts30d >= 12) breakdown.posting_frequency = 15
  else if (posts30d >= 8) breakdown.posting_frequency = 12
  else if (posts30d >= 4) breakdown.posting_frequency = 8
  else if (posts30d >= 2) breakdown.posting_frequency = 4

  // ── Business category (0–20 pts) ─────────────────────────────────
  if (TARGET_BUSINESS_CATEGORIES.some((c) => category.includes(c))) {
    breakdown.business_category = 20
  } else if (profile.is_business) {
    breakdown.business_category = 5
  }

  // ── Bio keywords (−10 to +15 pts) ────────────────────────────────
  const positiveMatches = POSITIVE_BIO_KEYWORDS.filter((re) => re.test(bio)).length
  const negativeMatches = NEGATIVE_BIO_KEYWORDS.filter((re) => re.test(bio)).length
  breakdown.bio_keywords = Math.min(15, positiveMatches * 5) - negativeMatches * 10

  // ── WhatsApp signals (0–10 pts) ───────────────────────────────────
  // WA contact = no website → ideal target
  const bioLinkUrls = (profile.bio_links ?? []).map((l) => l.url)
  const allText = [bio, profile.external_url ?? '', ...bioLinkUrls].join(' ')
  if (hasWhatsAppSignal(allText)) {
    breakdown.whatsapp_signals = 10
  }

  // ── Link verdict (−20 to +5 pts) ─────────────────────────────────
  const primaryUrl = profile.external_url ?? profile.bio_links?.[0]?.url ?? null
  const verdict = classifyLink(primaryUrl)
  switch (verdict) {
    case 'no_link':
      breakdown.link_verdict = 5   // no website at all = great target
      break
    case 'social_only':
      breakdown.link_verdict = 3
      break
    case 'aggregator':
      breakdown.link_verdict = 0   // neutral — aggregator ≠ own site
      break
    case 'marketplace':
      breakdown.link_verdict = -5  // has a store, less ideal
      break
    case 'own_site':
      breakdown.link_verdict = -20 // already has site → disqualify
      break
    case 'unknown':
      breakdown.link_verdict = 0
      break
  }

  breakdown.total =
    breakdown.followers +
    breakdown.recency +
    breakdown.posting_frequency +
    breakdown.business_category +
    breakdown.bio_keywords +
    breakdown.whatsapp_signals +
    breakdown.link_verdict

  // Clamp to 0–100
  breakdown.total = Math.max(0, Math.min(100, breakdown.total))

  return { score: breakdown.total, breakdown }
}
