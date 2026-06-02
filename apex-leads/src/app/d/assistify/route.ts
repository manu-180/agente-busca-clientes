/**
 * Smart redirect para descarga de Assistify.
 *
 * URL pública: https://assistify.lat/download
 *
 * - Android  → Play Store
 * - iOS      → App Store
 * - Desktop / otro → fallback al App Store (más común para clickear links desde WhatsApp web)
 *
 * Sin auth, sin DB, sin cookies. Solo user-agent → redirect.
 */

import { NextRequest, NextResponse } from 'next/server'

const PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.manuelnavarro.tallerdeceramica'
const APP_STORE  = 'https://apps.apple.com/app/assistify/id6745438721'

export const dynamic = 'force-dynamic'

export function GET(req: NextRequest) {
  const ua = req.headers.get('user-agent') ?? ''

  if (/android/i.test(ua)) {
    return NextResponse.redirect(PLAY_STORE, { status: 302 })
  }

  // iPhone, iPad, iPod
  if (/iphone|ipad|ipod/i.test(ua)) {
    return NextResponse.redirect(APP_STORE, { status: 302 })
  }

  // Desktop o user-agent desconocido → App Store (la mayoría de los links
  // de WhatsApp web los abre gente con iPhone; Play Store igual es válido
  // desde desktop).
  return NextResponse.redirect(APP_STORE, { status: 302 })
}
