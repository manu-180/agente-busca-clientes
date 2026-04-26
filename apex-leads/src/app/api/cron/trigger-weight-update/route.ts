import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (token !== cronSecret) {
    return unauthorized()
  }

  const sidecarUrl = process.env.IG_SIDECAR_URL
  const sidecarSecret = process.env.IG_SIDECAR_SECRET
  if (!sidecarUrl || !sidecarSecret) {
    return NextResponse.json(
      { ok: false, error: 'IG_SIDECAR_URL or IG_SIDECAR_SECRET not configured' },
      { status: 500 },
    )
  }

  const payload = JSON.stringify({})
  const sig = 'sha256=' + crypto.createHmac('sha256', sidecarSecret).update(payload).digest('hex')

  const res = await fetch(`${sidecarUrl}/jobs/update-weights`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sidecar-Signature': sig,
    },
    body: payload,
    signal: AbortSignal.timeout(280_000),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error('[trigger-weight-update] sidecar error', res.status, text)
    return NextResponse.json(
      { ok: false, error: `sidecar responded ${res.status}`, detail: text },
      { status: 502 },
    )
  }

  const data = await res.json()
  console.log('[trigger-weight-update] result', data)
  return NextResponse.json({ ok: true, ...data })
}
