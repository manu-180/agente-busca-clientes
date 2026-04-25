import { pickSourcesToRun, runOrchestratorCycle } from '../orchestrator'
import { SidecarError } from '../../sidecar'

jest.mock('../../sidecar', () => ({
  SidecarError: class SidecarError extends Error {
    constructor(public status: number, public detail: string) {
      super(`Sidecar ${status}: ${detail}`)
      this.name = 'SidecarError'
    }
    get isCircuitOpen() { return this.status === 503 }
  },
  discoverHashtag: jest.fn(),
  discoverLocation: jest.fn(),
  discoverCompetitorFollowers: jest.fn(),
  discoverPostEngagers: jest.fn(),
}))

import * as sidecar from '../../sidecar'

const mockHashtag = sidecar.discoverHashtag as jest.Mock
const mockLocation = sidecar.discoverLocation as jest.Mock
const mockCompetitor = sidecar.discoverCompetitorFollowers as jest.Mock
const mockEngagers = sidecar.discoverPostEngagers as jest.Mock

function makeSupabase(sources: object[], lastRun: object | null = null) {
  const supabase = {
    from: jest.fn().mockImplementation((table: string) => {
      if (table === 'discovery_sources') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockResolvedValue({ data: sources }),
        }
      }
      if (table === 'discovery_runs') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: lastRun }),
        }
      }
      return {}
    }),
  }
  return supabase
}

const SOURCE_HASHTAG = {
  id: 'src-1',
  kind: 'hashtag',
  ref: 'modaargentina',
  params: { limit: 50 },
  schedule_cron: '0 */6 * * *',
  priority: 10,
  active: true,
}

const SOURCE_LOCATION = {
  id: 'src-2',
  kind: 'location',
  ref: '123456',
  params: { limit: 30 },
  schedule_cron: '0 */12 * * *',
  priority: 5,
  active: true,
}

const SOURCE_COMPETITOR = {
  id: 'src-3',
  kind: 'competitor_followers',
  ref: 'rival_store',
  params: { max_users: 100 },
  schedule_cron: '0 8 * * *',
  priority: 8,
  active: true,
}

beforeEach(() => {
  jest.clearAllMocks()
  mockHashtag.mockResolvedValue({ run_id: 'r1', users_seen: 10, users_new: 5 })
  mockLocation.mockResolvedValue({ run_id: 'r2', users_seen: 8, users_new: 3 })
  mockCompetitor.mockResolvedValue({ run_id: 'r3', users_seen: 50, users_new: 20, next_cursor: null })
  mockEngagers.mockResolvedValue({ run_id: 'r4', users_seen: 15, users_new: 7 })
})

// ── pickSourcesToRun ──────────────────────────────────────────────────────────

describe('pickSourcesToRun', () => {
  it('includes sources whose next scheduled run is in the past', async () => {
    // No previous run → next run from epoch → always in past
    const sb = makeSupabase([SOURCE_HASHTAG], null)
    const now = new Date()
    const result = await pickSourcesToRun(sb, now)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('src-1')
  })

  it('excludes sources whose next scheduled run is in the future', async () => {
    // last run = 1 min ago, cron every 6h → next run is ~5h59m in future
    const lastRun = { started_at: new Date(Date.now() - 60_000).toISOString() }
    const sb = makeSupabase([SOURCE_HASHTAG], lastRun)
    const now = new Date()
    const result = await pickSourcesToRun(sb, now)
    expect(result).toHaveLength(0)
  })

  it('returns multiple due sources sorted by priority', async () => {
    const sb = makeSupabase([SOURCE_HASHTAG, SOURCE_LOCATION], null)
    const now = new Date()
    const result = await pickSourcesToRun(sb, now)
    expect(result).toHaveLength(2)
    // priority desc: hashtag(10) before location(5)
    expect(result[0].id).toBe('src-1')
    expect(result[1].id).toBe('src-2')
  })
})

// ── runOrchestratorCycle ──────────────────────────────────────────────────────

describe('runOrchestratorCycle', () => {
  it('calls correct sidecar function for each source kind', async () => {
    const sb = makeSupabase([SOURCE_HASHTAG, SOURCE_LOCATION], null)
    const result = await runOrchestratorCycle(sb)
    expect(result.ran).toBe(2)
    expect(mockHashtag).toHaveBeenCalledWith('modaargentina', 50)
    expect(mockLocation).toHaveBeenCalledWith(123456, 30)
  })

  it('allows only 1 competitor_followers source per cycle (anti-ban)', async () => {
    const COMPETITOR_2 = { ...SOURCE_COMPETITOR, id: 'src-4', ref: 'rival2' }
    const sb = makeSupabase([SOURCE_COMPETITOR, COMPETITOR_2], null)
    const result = await runOrchestratorCycle(sb)
    expect(mockCompetitor).toHaveBeenCalledTimes(1)
    // Second competitor should be skipped (still counted in ran only for the one that ran)
    expect(result.ran).toBe(1)
  })

  it('records error result and continues when a non-circuit error occurs', async () => {
    mockHashtag.mockRejectedValueOnce(new Error('timeout'))
    const sb = makeSupabase([SOURCE_HASHTAG, SOURCE_LOCATION], null)
    const result = await runOrchestratorCycle(sb)
    expect(result.ran).toBe(2)
    const results = result.results as Array<{ error?: string }>
    expect(results[0].error).toContain('timeout')
    // location should still have been called
    expect(mockLocation).toHaveBeenCalled()
  })

  it('aborts cycle when SidecarError with isCircuitOpen is thrown', async () => {
    mockHashtag.mockRejectedValueOnce(new (sidecar.SidecarError as any)(503, 'circuit_open'))
    const sb = makeSupabase([SOURCE_HASHTAG, SOURCE_LOCATION], null)
    const result = await runOrchestratorCycle(sb)
    // cycle aborted after first source
    expect(mockLocation).not.toHaveBeenCalled()
    expect(result.ran).toBe(1)
  })

  it('throws on unknown source kind and records error', async () => {
    const UNKNOWN_SOURCE = { ...SOURCE_HASHTAG, kind: 'unknown_kind' }
    const sb = makeSupabase([UNKNOWN_SOURCE], null)
    const result = await runOrchestratorCycle(sb)
    expect(result.ran).toBe(1)
    const results = result.results as Array<{ error?: string }>
    expect(results[0].error).toContain('unknown kind unknown_kind')
  })

  it('returns ran=0 when no sources are due', async () => {
    const lastRun = { started_at: new Date(Date.now() - 60_000).toISOString() }
    const sb = makeSupabase([SOURCE_HASHTAG], lastRun)
    const result = await runOrchestratorCycle(sb)
    expect(result.ran).toBe(0)
    expect(result.results).toHaveLength(0)
  })
})
