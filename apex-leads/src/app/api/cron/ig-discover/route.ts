/**
 * Cron: weekly (Sunday 06:00 UTC = 03:00 ART).
 * Launches Apify instagram-scraper actor for target hashtags.
 */
import { NextRequest, NextResponse } from 'next/server'
import { igConfig } from '@/lib/ig/config'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const APIFY_TOKEN = igConfig.APIFY_TOKEN
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? ''
const APIFY_WEBHOOK_SECRET = igConfig.APIFY_WEBHOOK_SECRET

const TARGET_HASHTAGS = [
  'modaargentina',
  'boutiquebuenosaires',
  'ropamujerba',
  'boutiquecaba',
  'indumentariafemenina',
  'modafemeninaargentina',
  'ropadeargentina',
]

function authCron(req: NextRequest): boolean {
  return req.headers.get('authorization') === `Bearer ${igConfig.CRON_SECRET}`
}

export async function GET(req: NextRequest) {
  if (!authCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results: Array<{ hashtag: string; runId?: string; error?: string }> = []

  for (const hashtag of TARGET_HASHTAGS) {
    try {
      const res = await fetch(
        'https://api.apify.com/v2/acts/apidojo~instagram-scraper/runs',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${APIFY_TOKEN}`,
          },
          body: JSON.stringify({
            startUrls: [{ url: `https://www.instagram.com/explore/tags/${hashtag}/` }],
            resultsLimit: 300,
            addParentData: false,
            webhooks: [
              {
                eventTypes: ['ACTOR.RUN.SUCCEEDED'],
                requestUrl: `${APP_URL}/api/webhooks/apify?token=${APIFY_WEBHOOK_SECRET}`,
                payloadTemplate: JSON.stringify({
                  eventType: '{{eventType}}',
                  eventData: { actorRunId: '{{actorRunId}}' },
                  sourceRef: hashtag,
                }),
              },
            ],
          }),
        },
      )

      const data = await res.json()
      results.push({ hashtag, runId: data?.data?.id })
    } catch (err) {
      results.push({ hashtag, error: String(err) })
    }
  }

  return NextResponse.json({ ok: true, launched: results })
}
