import { NextRequest, NextResponse } from 'next/server'

function getExpectedToken(): string {
  return (
    process.env.APEX_SESSION_TOKEN ??
    Buffer.from(process.env.ADMIN_PASSWORD ?? 'apex').toString('base64url')
  )
}

/**
 * Returns a 401 NextResponse if the request does not carry a valid admin cookie.
 * Returns null if the request is authorized (caller should proceed).
 *
 * The middleware already blocks unauthenticated requests to /api/admin/* routes,
 * but this adds a server-side check as defense-in-depth.
 */
export function requireAdmin(req: NextRequest): NextResponse | null {
  const cookie = req.cookies.get('apex_auth')?.value
  if (!cookie || cookie !== getExpectedToken()) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
