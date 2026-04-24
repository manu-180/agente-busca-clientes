import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { igConfig } from '@/lib/ig/config'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const APIFY_WEBHOOK_SECRET = igConfig.APIFY_WEBHOOK_SECRET
const APIFY_TOKEN = igConfig.APIFY_TOKEN

function verifyApifySignature(req: NextRequest, rawBody: string): boolean {
  const signature = req.headers.get('apify-webhook-signature')
  if (!signature || !APIFY_WEBHOOK_SECRET) return false
  const expected = crypto
    .createHmac('sha256', APIFY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex')
  const sigBuf = Buffer.from(signature)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length) return false
  return crypto.timingSafeEqual(sigBuf, expBuf)
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  if (!verifyApifySignature(req, rawBody)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Apify sends eventType='ACTOR.RUN.SUCCEEDED' with eventData.actorRunId
  const eventType = payload.eventType as string
  if (eventType !== 'ACTOR.RUN.SUCCEEDED') {
    return NextResponse.json({ ok: true, skipped: true, eventType })
  }

  const runId = (payload.eventData as Record<string, string>)?.actorRunId
  if (!runId) {
    return NextResponse.json({ error: 'Missing actorRunId' }, { status: 400 })
  }

  // Fetch dataset items from Apify
  const datasetRes = await fetch(
    `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?format=json&clean=true&limit=1000`,
    { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } },
  )

  if (!datasetRes.ok) {
    return NextResponse.json({ error: 'Failed to fetch Apify dataset' }, { status: 502 })
  }

  const items: Record<string, unknown>[] = await datasetRes.json()

  if (!items.length) {
    return NextResponse.json({ ok: true, inserted: 0 })
  }

  const supabase = createSupabaseServer()

  // Upsert raw profiles — deduplicate by ig_username
  const rows = items
    .filter((item) => item.username || item.ownerUsername)
    .map((item) => ({
      ig_username: (item.username ?? item.ownerUsername) as string,
      raw_profile: item,
      source: 'hashtag' as const,
      source_ref: (payload.sourceRef as string) ?? null,
      processed: false,
    }))

  const { error } = await supabase
    .from('instagram_leads_raw')
    .upsert(rows, { onConflict: 'ig_username', ignoreDuplicates: true })

  if (error) {
    console.error('[apify-webhook] upsert error', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, inserted: rows.length })
}
