/**
 * HTTP client for the Python instagrapi sidecar.
 * Signs every request with HMAC-SHA256 so the sidecar can verify origin.
 */
import crypto from 'crypto'
import { igConfig } from './config'

const SIDECAR_URL = igConfig.IG_SIDECAR_URL
const SIDECAR_SECRET = igConfig.IG_SIDECAR_SECRET

function sign(body: string): string {
  return (
    'sha256=' +
    crypto.createHmac('sha256', SIDECAR_SECRET).update(body).digest('hex')
  )
}

async function call<T>(path: string, body: unknown): Promise<T> {
  const payload = JSON.stringify(body)
  const res = await fetch(`${SIDECAR_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sidecar-Signature': sign(payload),
    },
    body: payload,
    // 60s timeout — DM send includes human dwell time
    signal: AbortSignal.timeout(60_000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new SidecarError(res.status, text)
  }

  return res.json() as Promise<T>
}

export class SidecarError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(`Sidecar ${status}: ${detail}`)
    this.name = 'SidecarError'
  }

  get isCircuitOpen() {
    return this.status === 503
  }
}

// ── Typed wrappers ──────────────────────────────────────────────────

export interface SendDMResult {
  thread_id: string
  message_id: string
}

export function sendDM(ig_username: string, text: string): Promise<SendDMResult> {
  return call('/dm/send', { ig_username, text, simulate_human: true })
}

export interface InboxMessage {
  thread_id: string
  message_id: string
  ig_username: string
  text: string
  timestamp: number
  is_outbound: boolean
}

export function pollInbox(since_ts?: number): Promise<{ messages: InboxMessage[] }> {
  return call('/inbox/poll', { since_ts: since_ts ?? null })
}

export interface ProfileData {
  ig_user_id: string
  ig_username: string
  full_name: string | null
  biography: string | null
  external_url: string | null
  bio_links: Array<{ url: string; title?: string }>
  followers_count: number
  following_count: number
  posts_count: number
  is_private: boolean
  is_verified: boolean
  is_business: boolean
  business_category: string | null
  profile_pic_url: string | null
  last_post_at: string | null
}

export function enrichProfiles(
  usernames: string[],
): Promise<{ profiles: ProfileData[]; errors: Record<string, string> }> {
  return call('/profile/enrich', { usernames })
}

// ── Discovery ───────────────────────────────────────────────────────

export interface DiscoverResult {
  run_id: string
  users_seen: number
  users_new: number
}

export interface DiscoverCompetitorResult extends DiscoverResult {
  next_cursor: string | null
}

export function discoverHashtag(tag: string, limit = 50): Promise<DiscoverResult> {
  return call('/discover/hashtag', { tag, limit })
}

export function discoverLocation(location_pk: number, limit = 50): Promise<DiscoverResult> {
  return call('/discover/location', { location_pk, limit })
}

export function discoverCompetitorFollowers(
  username: string,
  max_users = 200,
  cursor?: string,
): Promise<DiscoverCompetitorResult> {
  return call('/discover/competitor-followers', { username, max_users, cursor: cursor ?? null })
}

export function discoverPostEngagers(
  media_pk: string,
  kind: 'likers' | 'commenters' = 'likers',
): Promise<DiscoverResult> {
  return call('/discover/post-engagers', { media_pk, kind })
}
