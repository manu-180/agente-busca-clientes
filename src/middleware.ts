import { NextRequest, NextResponse } from 'next/server'

function getExpectedToken(): string {
  return process.env.APEX_SESSION_TOKEN
    ?? Buffer.from(process.env.ADMIN_PASSWORD ?? 'apex').toString('base64url')
}

function isValidAuthCookie(value: string | undefined): boolean {
  if (!value) return false
  return value === getExpectedToken()
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname.startsWith('/api/webhook')) {
    return NextResponse.next()
  }

  if (pathname.startsWith('/api/cron/')) {
    return NextResponse.next()
  }

  if (pathname === '/api/auth') {
    return NextResponse.next()
  }

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
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
