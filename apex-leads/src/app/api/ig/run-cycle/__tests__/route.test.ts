import { NextRequest } from 'next/server'

// Must be set before the route module is imported (read at call-time, but mock setup runs first)
process.env.CRON_SECRET = 'test-cron-secret'

// ── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('@/lib/ig/config', () => ({
  igConfig: {
    DRY_RUN: false,
    DAILY_DM_LIMIT: 5,
    IG_SENDER_USERNAME: 'apex.stack',
    IG_SIDECAR_URL: 'http://localhost:9999',
    IG_SIDECAR_SECRET: 'testsecreto',
    MIN_SCORE_FOR_DM: 60,
    ANTHROPIC_API_KEY: 'sk-ant-test',
    CLAUDE_HAIKU_MODEL: 'claude-haiku-4-5-20251001',
    DISCOVERY_ENABLED: true,
    DISCORD_ALERT_WEBHOOK: null,
  },
}))

// Uses __mocks__/sidecar.ts
jest.mock('@/lib/ig/sidecar')

jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServer: jest.fn(),
}))

jest.mock('@/lib/ig/alerts/discord', () => ({
  sendAlert: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/ig/classify', () => ({
  isTargetLead: jest.fn().mockReturnValue(true),
  classifyLink: jest.fn().mockReturnValue('no_link'),
}))

jest.mock('@/lib/ig/classify/niche', () => ({
  classifyNiche: jest.fn().mockResolvedValue({ niche: 'moda_femenina', confidence: 0.9 }),
  checkDailyCostAlert: jest.fn().mockResolvedValue(undefined),
  NICHE_VALUES: [
    'moda_femenina',
    'moda_masculina',
    'indumentaria_infantil',
    'accesorios',
    'calzado',
    'belleza_estetica',
    'joyeria',
    'otro',
  ],
}))

jest.mock('@/lib/ig/score/v2', () => ({
  loadProductionWeights: jest.fn().mockResolvedValue({ version: 'v1', weights: {} }),
  computeScore: jest.fn().mockReturnValue({ score: 70 }),
  scoreWithShadow: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/ig/score/features', () => ({
  extractFeatures: jest.fn().mockReturnValue({}),
}))

jest.mock('@/lib/ig/templates/selector', () => ({
  pickTemplate: jest.fn().mockResolvedValue({ id: 'tmpl-1', name: 'opener_v1', body: 'Hola {{first_name}}' }),
  renderTemplate: jest.fn().mockReturnValue('Hola Test'),
}))

jest.mock('@/lib/ig/discover/pre-filter', () => ({
  preFilter: jest.fn().mockReturnValue({ keep: true }),
  loadBlacklist: jest.fn().mockResolvedValue([]),
}))

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { createSupabaseServer } from '@/lib/supabase-server'
import { POST } from '../route'

// ── Supabase mock helpers ────────────────────────────────────────────────────

type MockResolved = { data: unknown; error: unknown }

function makeChain(resolved: MockResolved) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {}
  for (const m of ['select', 'eq', 'is', 'in', 'limit', 'update', 'upsert', 'insert']) {
    self[m] = jest.fn().mockReturnValue(self)
  }
  self.maybeSingle = jest.fn().mockResolvedValue(resolved)
  self.single = jest.fn().mockResolvedValue(resolved)
  // Make chain directly awaitable (for calls that end without a terminal method)
  const p = Promise.resolve(resolved)
  self.then = p.then.bind(p)
  self.catch = p.catch.bind(p)
  return self
}

function mockSupabaseFor(tables: Record<string, MockResolved>) {
  return {
    from: jest.fn().mockImplementation((table: string) =>
      makeChain(tables[table] ?? { data: null, error: null }),
    ),
  }
}

function makeRequest() {
  return new NextRequest('http://localhost/api/ig/run-cycle', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-cron-secret' },
  })
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/ig/run-cycle', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns daily_limit_reached when quota is exhausted', async () => {
    // DAILY_DM_LIMIT=5, dms_sent=5 → remaining=0
    ;(createSupabaseServer as jest.Mock).mockReturnValue(
      mockSupabaseFor({
        dm_daily_quota: { data: { dms_sent: 5 }, error: null },
      }),
    )

    const res = await POST(makeRequest())
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.reason).toBe('daily_limit_reached')
    expect(body.leads_processed).toBe(0)
  })

  it('returns no_raw_leads when instagram_leads_raw is empty', async () => {
    // dms_sent=0 → remaining=5; raw leads query returns empty array
    ;(createSupabaseServer as jest.Mock).mockReturnValue(
      mockSupabaseFor({
        dm_daily_quota: { data: { dms_sent: 0 }, error: null },
        instagram_leads_raw: { data: [], error: null },
      }),
    )

    const res = await POST(makeRequest())
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.reason).toBe('no_raw_leads')
    expect(body.leads_processed).toBe(0)
  })
})
