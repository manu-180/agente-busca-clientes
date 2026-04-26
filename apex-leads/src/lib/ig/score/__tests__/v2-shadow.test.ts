import { loadCandidateWeights, scoreWithShadow } from '../v2'
import type { Features } from '../features'

const SAMPLE_FEATURES: Features = {
  followers_log: 0.7,
  posts_log: 0.6,
  engagement_rate: 0.4,
  has_business_category: 1,
  business_category_match: 1,
  bio_keyword_match: 0.6,
  has_external_url: 1,
  link_is_linktree_or_ig_only: 1,
  posts_recency: 0.8,
  niche_classifier_confidence: 0.9,
}

const CANDIDATE_WEIGHTS = {
  bias: -2.0,
  followers_log: 1.2,
  posts_log: 0.7,
  engagement_rate: 0.9,
  has_business_category: 0.5,
  business_category_match: 1.0,
  bio_keyword_match: 1.3,
  has_external_url: 0.2,
  link_is_linktree_or_ig_only: 0.6,
  posts_recency: 0.6,
  niche_classifier_confidence: 1.8,
}

function makeCandidateSupabase() {
  const row = { id: 'cand-1', version: 2, status: 'candidate', weights: CANDIDATE_WEIGHTS }
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => ({
              maybeSingle: async () => ({ data: row, error: null }),
            }),
          }),
        }),
      }),
    }),
  }
}

function makeEmptySupabase() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      }),
    }),
  }
}

// ── loadCandidateWeights ──────────────────────────────────────────────────────

describe('loadCandidateWeights', () => {
  it('returns null when no candidate row exists', async () => {
    const result = await loadCandidateWeights(makeEmptySupabase())
    expect(result).toBeNull()
  })

  it('returns the candidate row when one exists', async () => {
    const result = await loadCandidateWeights(makeCandidateSupabase())
    expect(result).not.toBeNull()
    expect(result!.version).toBe(2)
    expect(result!.status).toBe('candidate')
  })
})

// ── scoreWithShadow ───────────────────────────────────────────────────────────

describe('scoreWithShadow', () => {
  it('does not throw when candidate weights exist', async () => {
    await expect(
      scoreWithShadow(makeCandidateSupabase(), SAMPLE_FEATURES, 72),
    ).resolves.toBeUndefined()
  })

  it('does not throw when no candidate weights exist (early return)', async () => {
    await expect(
      scoreWithShadow(makeEmptySupabase(), SAMPLE_FEATURES, 72),
    ).resolves.toBeUndefined()
  })

  it('does not throw when supabase call rejects (fire-and-forget guard)', async () => {
    const errorSupabase = {
      from: () => {
        throw new Error('supabase exploded')
      },
    }
    await expect(
      scoreWithShadow(errorSupabase, SAMPLE_FEATURES, 72),
    ).resolves.toBeUndefined()
  })

  it('logs the difference without throwing', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    await scoreWithShadow(makeCandidateSupabase(), SAMPLE_FEATURES, 72)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[shadow-scoring]'),
    )
    consoleSpy.mockRestore()
  })
})
