import { NextRequest, NextResponse } from 'next/server'

const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000

const loginAttempts = new Map<string, { count: number; resetAt: number }>()

function getSessionToken(): string {
  return process.env.APEX_SESSION_TOKEN
    ?? Buffer.from(process.env.ADMIN_PASSWORD ?? 'apex').toString('base64url')
}

function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  const now = Date.now()

  const entry = loginAttempts.get(ip)
  if (entry && now < entry.resetAt) {
    if (entry.count >= RATE_LIMIT_MAX) {
      return NextResponse.json({ error: 'Demasiados intentos, esperá 15 minutos' }, { status: 429 })
    }
  }

  const body = await req.json()
  const { password } = body

  if (password === process.env.ADMIN_PASSWORD) {
    loginAttempts.delete(ip)
    const token = getSessionToken()
    const response = NextResponse.json({ ok: true })
    response.cookies.set('apex_auth', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
      path: '/',
    })
    return response
  }

  const existing = loginAttempts.get(ip)
  if (existing && now < existing.resetAt) {
    existing.count++
  } else {
    loginAttempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
  }

  return NextResponse.json({ error: 'Contraseña incorrecta' }, { status: 401 })
}
