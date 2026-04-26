import type { ProfileData } from '../sidecar'
import type { ClassificationResult } from '../classify/niche'

const NICHE_WHITELIST_KEYWORDS = [
  'moda', 'indumentaria', 'ropa', 'boutique', 'showroom', 'fashion', 'clothes',
  'wear', 'tienda', 'shop', 'beauty', 'belleza', 'estetica', 'accesorios',
  'joyeria', 'calzado', 'zapatos',
]

const TARGET_BUSINESS_CATEGORIES = [
  "Clothing (Brand)",
  "Shopping & retail",
  "Personal Goods & General Merchandise Stores",
  "Beauty, cosmetic & personal care",
]

const TARGET_NICHES = new Set([
  'moda_femenina', 'moda_masculina', 'indumentaria_infantil',
  'accesorios', 'calzado', 'belleza_estetica', 'joyeria',
])

export interface Features {
  followers_log: number
  posts_log: number
  engagement_rate: number
  has_business_category: number
  business_category_match: number
  bio_keyword_match: number
  has_external_url: number
  link_is_linktree_or_ig_only: number
  posts_recency: number
  niche_classifier_confidence: number
}

export function extractFeatures(
  profile: ProfileData,
  niche: ClassificationResult | null,
  linkVerdict: string,
): Features {
  const fol = Number(profile.followers_count ?? 0)
  const pst = Number(profile.posts_count ?? 0)
  const bio = (profile.biography ?? '').toLowerCase()
  const bioHits = NICHE_WHITELIST_KEYWORDS.filter((k) => bio.includes(k)).length
  const cat = profile.business_category ?? ''
  const lastPostDays = profile.last_post_at
    ? Math.floor((Date.now() - new Date(profile.last_post_at).getTime()) / 86_400_000)
    : 90
  const engagement = (profile as ProfileData & { engagement_rate?: number }).engagement_rate ?? 0

  return {
    followers_log: Math.min(Math.log10(fol + 1) / 5, 1),
    posts_log: Math.min(Math.log10(pst + 1) / 4, 1),
    engagement_rate: Math.min(engagement * 5, 1),
    has_business_category: cat ? 1 : 0,
    business_category_match: TARGET_BUSINESS_CATEGORIES.some((t) => cat.includes(t)) ? 1 : 0,
    bio_keyword_match: Math.min(bioHits / 5, 1),
    has_external_url: profile.external_url ? 1 : 0,
    link_is_linktree_or_ig_only: linkVerdict !== 'own_site' ? 1 : 0,
    posts_recency: 1 - Math.min(lastPostDays / 90, 1),
    niche_classifier_confidence:
      niche && TARGET_NICHES.has(niche.niche) ? niche.confidence : 0,
  }
}
