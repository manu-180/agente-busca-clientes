import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { password } = body

  if (password === process.env.ADMIN_PASSWORD) {
    const response = NextResponse.json({ ok: true })
    response.cookies.set('apex_auth', 'true', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 días
      path: '/',
    })
    return response
  }

  return NextResponse.json({ error: 'Contraseña incorrecta' }, { status: 401 })
}
