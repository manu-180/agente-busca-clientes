export interface RawLead {
  id: string
  ig_username: string
  raw_profile: Record<string, unknown>
  source_ref?: string
}

export interface PreFilterResult {
  keep: boolean
  reason?: string
}

const MIN_FOLLOWERS = 200
const MAX_FOLLOWERS = 100_000
const MIN_POSTS = 5

// Some rows from the D02 sidecar (hashtag_medias_recent) arrive without followers_count.
// For those, followers === 0 and the guards below use `followers &&` so they pass through
// to enrich (where the full profile is fetched). This is intentional — pre-filter kills
// obvious rejects; quality guarantees come after enrichment.
export function preFilter(raw: RawLead, blacklist: Set<string>): PreFilterResult {
  if (blacklist.has(raw.ig_username.toLowerCase())) return { keep: false, reason: 'blacklisted' }

  const p = raw.raw_profile as Record<string, unknown>
  const followers = Number(p.followersCount ?? p.followers_count ?? p.follower_count ?? 0)
  const posts = Number(p.postsCount ?? p.posts_count ?? p.media_count ?? 0)
  const isPrivate = Boolean(p.isPrivate ?? p.is_private)
  const isVerified = Boolean(p.isVerified ?? p.is_verified)

  if (isPrivate) return { keep: false, reason: 'private' }
  if (isVerified) return { keep: false, reason: 'verified' }
  if (followers && followers < MIN_FOLLOWERS) return { keep: false, reason: 'low_followers' }
  if (followers && followers > MAX_FOLLOWERS) return { keep: false, reason: 'too_many_followers' }
  if (posts && posts < MIN_POSTS) return { keep: false, reason: 'low_posts' }

  return { keep: true }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadBlacklist(supabase: any): Promise<Set<string>> {
  const { data } = await supabase.from('lead_blacklist').select('ig_username')
  return new Set(((data ?? []) as Array<{ ig_username: string }>).map((r) => r.ig_username.toLowerCase()))
}
