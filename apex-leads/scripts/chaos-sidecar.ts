#!/usr/bin/env tsx
/**
 * CHAOS DRILL: Kill sidecar → verify run-cycle resilience.
 *
 * Setup (one-time):
 *   1. In .env.local, set: IG_SIDECAR_URL=http://localhost:1  (dead port)
 *   2. Optionally set DRY_RUN=true to avoid touching instagram_leads_raw
 *   3. Start the dev server: npm run dev
 *   4. Run this script: npx tsx scripts/chaos-sidecar.ts
 *
 * Expected results:
 *   • HTTP 200 with body.error === 'circuit_open' (if raw leads were present)
 *   • HTTP 200 with body.reason === 'no_raw_leads'  (if queue is empty — safe)
 *   • HTTP 200 with body.reason === 'daily_limit_reached' (if quota exhausted)
 *   • NEVER an unhandled 500 or server crash
 *
 * Manual checks after the drill:
 *   □ alerts_log: should have severity=critical, source=sidecar row
 *     (only if raw leads existed and enrich/send was attempted)
 *   □ ig_circuit_breaker (sidecar table): status=open
 *     (sidecar tracks circuit state; verify via Railway logs or Supabase)
 *
 * Clean-state note:
 *   With DRY_RUN=true the route never touches instagram_leads or dm_daily_quota.
 *   For a completely stateless drill, ensure instagram_leads_raw is empty first.
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const CRON_SECRET = process.env.CRON_SECRET ?? ''

if (!CRON_SECRET) {
  console.error('ERROR: CRON_SECRET env var not set. Export it before running.')
  process.exit(1)
}

async function main() {
  console.log('\n🔥  CHAOS DRILL — Sidecar Kill Test')
  console.log(`    Target : ${BASE_URL}/api/ig/run-cycle`)
  console.log(`    Secret : ****${CRON_SECRET.slice(-4)}\n`)

  const start = Date.now()
  let res: Response

  try {
    res = await fetch(`${BASE_URL}/api/ig/run-cycle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CRON_SECRET}`,
      },
      signal: AbortSignal.timeout(30_000),
    })
  } catch (err) {
    console.error('❌  FAIL: fetch threw — is the dev server running?')
    console.error(err)
    process.exit(1)
  }

  const elapsed = Date.now() - start
  const body = await res.json().catch(() => null)

  console.log(`Status  : ${res.status}  (${elapsed}ms)`)
  console.log(`Body    :`, JSON.stringify(body, null, 2))

  // Assertions — the server must not crash; any controlled response is OK
  const httpOk = res.status === 200 || res.status === 503
  const bodyOk =
    body !== null &&
    (body.error === 'circuit_open' ||
      body.reason === 'no_raw_leads' ||
      body.reason === 'daily_limit_reached' ||
      body.reason === 'all_duplicates' ||
      typeof body.leads_processed === 'number')

  if (!httpOk) {
    console.error(`\n❌  FAIL: unexpected HTTP ${res.status} — expected 200 or 503`)
    process.exit(1)
  }

  if (!bodyOk) {
    console.error('\n❌  FAIL: response body did not match any expected shape')
    process.exit(1)
  }

  console.log('\n✅  PASS: run-cycle survived sidecar outage without crashing')
  console.log('\nManual verification checklist:')
  console.log('  □ Supabase → alerts_log: critical/sidecar row present?')
  console.log('  □ Railway → sidecar logs: circuit_breaker opened?')
  console.log('  □ No unexpected rows in instagram_leads with bad state')
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
