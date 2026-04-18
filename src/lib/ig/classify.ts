import { hasWhatsAppSignal } from './detect_whatsapp'

export type LinkVerdict =
  | 'no_link'
  | 'aggregator'
  | 'social_only'
  | 'marketplace'
  | 'own_site'
  | 'unknown'

// Link-in-bio aggregators — no tienen sitio propio
const AGGREGATORS = [
  'linktr.ee',
  'beacons.ai',
  'linkin.bio',
  'bio.link',
  'taplink.cc',
  'msha.ke',
  'campsite.bio',
  'carrd.co',
  'allmylinks.com',
  'stan.store',
  'hoo.be',
  'lnk.bio',
  'milkshake.app',
]

// Solo redes sociales o WhatsApp — sin sitio web
const SOCIAL_DM_ONLY = [
  'wa.me',
  'api.whatsapp.com',
  'instagram.com',
  'www.instagram.com',
  'm.me',
  'facebook.com',
  't.me',
  'tiktok.com',
  'twitter.com',
  'x.com',
  'youtube.com',
]

// Marketplaces / constructores de tienda — tienen "sitio" pero no propio
const MARKETPLACE_PLATFORMS = [
  'tiendanube.com',
  'mitiendanube.com',
  'empretienda.com.ar',
  'mercadoshops.com.ar',
  'shopify.com',
  'wixsite.com',
  'wix.com',
  'weebly.com',
  'squarespace.com',
  'jumpseller.com',
  'ecwid.com',
  'vtex.com',
  'nuvemshop.com.br',
]

// TLDs / patrones de dominio propio
const OWN_SITE_TLDS = [
  '.com.ar',
  '.ar',
  '.com',
  '.shop',
  '.store',
  '.boutique',
  '.net',
  '.org',
  '.co',
  '.io',
]

function extractHostname(url: string): string {
  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`
    return new URL(normalized).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return url.toLowerCase()
  }
}

export function classifyLink(url: string | null | undefined): LinkVerdict {
  if (!url || url.trim() === '') return 'no_link'

  const host = extractHostname(url)

  if (AGGREGATORS.some((a) => host === a || host.endsWith(`.${a}`))) return 'aggregator'
  if (SOCIAL_DM_ONLY.some((s) => host === s || host.endsWith(`.${s}`))) return 'social_only'
  if (MARKETPLACE_PLATFORMS.some((m) => host === m || host.endsWith(`.${m}`))) return 'marketplace'
  if (OWN_SITE_TLDS.some((tld) => host.endsWith(tld))) return 'own_site'

  return 'unknown'
}

export interface IgProfile {
  ig_username?: string
  biography?: string | null
  external_url?: string | null
  bio_links?: Array<{ url: string; title?: string }>
  followers_count?: number
  following_count?: number
  posts_count?: number
  is_private?: boolean
  is_verified?: boolean
  is_business?: boolean
  business_category?: string | null
  last_post_at?: string | null
  posts_last_30d?: number
}

const NEGATIVE_KEYWORDS = [
  /mayorist[ao]/i,
  /revende/i,
  /distribuid/i,
  /influencer/i,
  /coach/i,
  /mentor/i,
  /afiliado/i,
  /network\s+marketing/i,
  /multinivel/i,
  /emprendedor.*genéric/i,
]

export function isTargetLead(profile: IgProfile): boolean {
  // Skip private or verified accounts
  if (profile.is_private) return false
  if (profile.is_verified) return false

  // Need minimum activity
  const followers = profile.followers_count ?? 0
  const posts = profile.posts_count ?? 0
  if (followers < 200 || posts < 5) return false

  // Discard if too large (likely established brand)
  if (followers > 100_000) return false

  const bio = profile.biography ?? ''

  // Discard if bio has negative signals
  if (NEGATIVE_KEYWORDS.some((re) => re.test(bio))) return false

  // Determine link verdict
  const primaryUrl = profile.external_url ?? profile.bio_links?.[0]?.url ?? null
  const verdict = classifyLink(primaryUrl)

  // We want accounts WITHOUT their own website
  // own_site = already has a site → skip
  if (verdict === 'own_site') return false

  return true
}
