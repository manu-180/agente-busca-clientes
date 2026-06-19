import { NextRequest, NextResponse } from 'next/server'

// ---------------------------------------------------------------------------
// Rate-limit store (in-memory, module-level)
//
// CAVEAT: Edge runtime can spin up multiple isolates (per region, per cold
// start). This Map is NOT shared across isolates — each isolate has its own
// counter. In practice this means the effective limit is
//   (isolates_per_region × RATE_LIMIT_PER_MINUTE)
// in the worst case. A real bot would have to hit the same isolate with the
// same IP to be blocked. That said, most bots don't rotate IPs fast enough to
// avoid this: if they hammer a single endpoint they'll land on the same
// isolate repeatedly (Vercel routes by source-IP affinity in many regions),
// and they'll get cut off. For a shared Redis-backed solution use
// @upstash/redis + @upstash/ratelimit, but that requires new dependencies.
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number
  resetAt: number // epoch ms
}

const rateLimitMap = new Map<string, RateLimitEntry>()
const MAP_MAX_SIZE = 10_000

function getRateLimit(): number {
  const env = process.env.RATE_LIMIT_PER_MINUTE
  if (env) {
    const parsed = parseInt(env, 10)
    if (!isNaN(parsed) && parsed > 0) return parsed
  }
  // 600/min: el rate-limit solo aplica a rutas autenticadas (webhook/cron/auth
  // están exentas arriba), así que en la práctica solo frena al propio panel de
  // admin. Los barridos de Google Places hacen 1 request por localidad; un scan
  // nacional son cientos en pocos minutos. 60 era muy bajo y abortaba el barrido
  // (429) antes de llegar al encolado. 600 cubre incluso concurrencia 8 (el
  // máximo que ofrece la UI de "Nuevo Lead").
  return 600
}

/**
 * Returns the first non-empty string from x-forwarded-for (comma list),
 * then x-real-ip, then 'unknown'. All 'unknown' IPs share a single bucket —
 * acceptable because Vercel always injects one of the above in production.
 */
function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  const xri = req.headers.get('x-real-ip')
  if (xri) return xri.trim()
  return 'unknown'
}

/**
 * Passive sweep: delete any entry whose window has expired.
 * Called every time we need to add a new entry and the map is near capacity.
 */
function sweepExpired(now: number): void {
  for (const [key, entry] of rateLimitMap) {
    if (entry.resetAt <= now) rateLimitMap.delete(key)
  }
}

/**
 * Checks the rate limit for a given IP. Returns an object describing whether
 * the request is allowed and the current window state.
 */
function checkRateLimit(ip: string): {
  allowed: boolean
  limit: number
  remaining: number
  resetAt: number // epoch ms
} {
  const now = Date.now()
  const limit = getRateLimit()
  const windowMs = 60_000

  let entry = rateLimitMap.get(ip)

  if (!entry || entry.resetAt <= now) {
    // No entry or expired window — start fresh
    if (rateLimitMap.size >= MAP_MAX_SIZE) {
      sweepExpired(now)
      // If still too large after sweep, evict the oldest quarter (LRU-ish)
      if (rateLimitMap.size >= MAP_MAX_SIZE) {
        const evictCount = Math.floor(MAP_MAX_SIZE / 4)
        let evicted = 0
        for (const key of rateLimitMap.keys()) {
          rateLimitMap.delete(key)
          evicted++
          if (evicted >= evictCount) break
        }
      }
    }
    entry = { count: 1, resetAt: now + windowMs }
    rateLimitMap.set(ip, entry)
    return { allowed: true, limit, remaining: limit - 1, resetAt: entry.resetAt }
  }

  entry.count++

  if (entry.count > limit) {
    return { allowed: false, limit, remaining: 0, resetAt: entry.resetAt }
  }

  return {
    allowed: true,
    limit,
    remaining: limit - entry.count,
    resetAt: entry.resetAt,
  }
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function getExpectedToken(): string {
  return process.env.APEX_SESSION_TOKEN
    ?? Buffer.from(process.env.ADMIN_PASSWORD ?? 'apex').toString('base64url')
}

function isValidAuthCookie(value: string | undefined): boolean {
  if (!value) return false
  return value === getExpectedToken()
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 1. Always allow excluded routes (webhooks, cron, ig callback, auth login)
  if (pathname.startsWith('/api/webhook')) return NextResponse.next()
  if (pathname.startsWith('/api/cron/'))   return NextResponse.next()
  // Bridge de reservas desde theapexweb.com — self-auth con Bearer CRON_SECRET.
  if (pathname.startsWith('/api/booking/')) return NextResponse.next()
  if (pathname.startsWith('/api/ig/'))     return NextResponse.next()
  if (pathname === '/api/auth')            return NextResponse.next()

  // 2. Rate limit — only for /api/* (excluding the routes above already returned)
  if (pathname.startsWith('/api/')) {
    const ip = getClientIp(request)
    const rl = checkRateLimit(ip)

    const resetInSeconds = Math.ceil((rl.resetAt - Date.now()) / 1000)

    if (!rl.allowed) {
      console.warn(
        `[ratelimit] 429 ip=${ip} path=${pathname} count=${rateLimitMap.get(ip)?.count ?? '?'} limit=${rl.limit}`
      )
      return NextResponse.json(
        { error: 'Too many requests' },
        {
          status: 429,
          headers: {
            'Retry-After':          String(resetInSeconds),
            'X-RateLimit-Limit':    String(rl.limit),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset':    String(Math.ceil(rl.resetAt / 1000)),
          },
        }
      )
    }

    // Attach informational rate-limit headers to allowed responses too
    const response = enforceAuth(request, pathname)
    response.headers.set('X-RateLimit-Limit',     String(rl.limit))
    response.headers.set('X-RateLimit-Remaining', String(rl.remaining))
    response.headers.set('X-RateLimit-Reset',     String(Math.ceil(rl.resetAt / 1000)))
    return response
  }

  // 3. Non-API paths: just enforce auth (login page + protected pages)
  return enforceAuth(request, pathname)
}

/** Cookie-based auth guard, extracted so rate-limit can reuse it. */
function enforceAuth(request: NextRequest, pathname: string): NextResponse {
  const authCookie = request.cookies.get('apex_auth')

  if (pathname === '/login') {
    if (isValidAuthCookie(authCookie?.value)) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
    return NextResponse.next()
  }

  if (!isValidAuthCookie(authCookie?.value)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
