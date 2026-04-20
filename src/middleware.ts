import { NextRequest, NextResponse } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // El webhook de Wassenger no requiere auth
  if (pathname.startsWith('/api/webhook')) {
    return NextResponse.next()
  }

  // Los crons tienen su propio token Bearer, no necesitan cookie
  if (pathname.startsWith('/api/cron/')) {
    return NextResponse.next()
  }

  // El endpoint de login debe quedar público
  if (pathname === '/api/auth') {
    return NextResponse.next()
  }

  // Verificar auth para todas las rutas
  const authCookie = request.cookies.get('apex_auth')
  
  if (pathname === '/login') {
    if (authCookie?.value === 'true') {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
    return NextResponse.next()
  }

  if (!authCookie || authCookie.value !== 'true') {
    // Si es API, devolver 401
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }
    // Si es página, redirigir a login
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
