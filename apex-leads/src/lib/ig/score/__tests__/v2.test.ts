import { extractFeatures } from '../features'
import { computeScore, loadProductionWeights, scoreAndPersist } from '../v2'
import type { ProfileData } from '../../sidecar'
import type { ClassificationResult } from '../../classify/niche'

// ── Seed weights matching the SQL seed ────────────────────────────────────────

const SEED_WEIGHTS: Record<string, number> = {
  bias: -2.5,
  followers_log: 1.5,
  posts_log: 0.8,
  engagement_rate: 1.0,
  has_business_category: 0.6,
  business_category_match: 1.2,
  bio_keyword_match: 1.5,
  has_external_url: 0.3,
  link_is_linktree_or_ig_only: 0.8,
  posts_recency: 0.7,
  niche_classifier_confidence: 2.0,
}

// ── Profile factories ─────────────────────────────────────────────────────────

function baseProfile(overrides: Partial<ProfileData> = {}): ProfileData {
  return {
    ig_user_id: '100',
    ig_username: 'test_boutique',
    full_name: 'Test Boutique',
    biography: null,
    external_url: null,
    bio_links: [],
    followers_count: 0,
    following_count: 0,
    posts_count: 0,
    is_private: false,
    is_verified: false,
    is_business: false,
    business_category: null,
    profile_pic_url: null,
    last_post_at: null,
    ...overrides,
  }
}

function recentDate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('extractFeatures', () => {
  it('normalises followers_log between 0 and 1', () => {
    const f = extractFeatures(baseProfile({ followers_count: 5000 }), null, 'no_link')
    expect(f.followers_log).toBeGreaterThan(0)
    expect(f.followers_log).toBeLessThanOrEqual(1)
  })

  it('bio_keyword_match hits on boutique / ropa / moda', () => {
    const f = extractFeatures(
      baseProfile({ biography: 'boutique ropa moda envíos' }),
      null,
      'no_link',
    )
    expect(f.bio_keyword_match).toBeGreaterThan(0)
  })

  it('link_is_linktree_or_ig_only is 0 for own_site', () => {
    const f = extractFeatures(baseProfile(), null, 'own_site')
    expect(f.link_is_linktree_or_ig_only).toBe(0)
  })

  it('niche_classifier_confidence is 0 for non-target niche', () => {
    const cls: ClassificationResult = { niche: 'otro', confidence: 0.9, reason: 'misc' }
    const f = extractFeatures(baseProfile(), cls, 'no_link')
    expect(f.niche_classifier_confidence).toBe(0)
  })

  it('posts_recency is 0 when last_post_at is 90+ days ago', () => {
    const f = extractFeatures(baseProfile({ last_post_at: recentDate(100) }), null, 'no_link')
    expect(f.posts_recency).toBe(0)
  })
})

describe('computeScore', () => {
  it('returns score in 0–100 range', () => {
    const features = extractFeatures(baseProfile(), null, 'no_link')
    const { score } = computeScore(features, SEED_WEIGHTS)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })
})

describe('scoring profiles', () => {
  it('ideal boutique profile scores > 75', () => {
    const profile = baseProfile({
      followers_count: 5000,
      posts_count: 100,
      biography: 'moda femenina ✨ envíos a todo el país boutique exclusiva',
      business_category: 'Clothing (Brand)',
      last_post_at: recentDate(3),
      external_url: 'https://linktr.ee/boutique',
    })
    const cls: ClassificationResult = { niche: 'moda_femenina', confidence: 0.9, reason: 'boutique' }
    const features = extractFeatures(profile, cls, 'aggregator')
    const { score } = computeScore(features, SEED_WEIGHTS)
    expect(score).toBeGreaterThan(75)
  })

  it('marginal profile scores between 40 and 65', () => {
    // No niche match → niche_classifier_confidence = 0.
    // A few positives (some keywords, decent followers, recent posts) but no
    // business category and no niche signal → mid-range score.
    const profile = baseProfile({
      followers_count: 1500,
      posts_count: 25,
      biography: 'tienda online envíos',   // 1-2 keyword hits
      business_category: null,
      last_post_at: recentDate(45),
      external_url: null,
    })
    // 'otro' is not in TARGET_NICHES → niche_classifier_confidence = 0
    const cls: ClassificationResult = { niche: 'otro', confidence: 0.8, reason: 'unclear' }
    const features = extractFeatures(profile, cls, 'no_link')
    const { score } = computeScore(features, SEED_WEIGHTS)
    expect(score).toBeGreaterThanOrEqual(40)
    expect(score).toBeLessThanOrEqual(65)
  })

  it('discardable profile scores < 30', () => {
    const profile = baseProfile({
      followers_count: 50,
      posts_count: 2,
      biography: null,
      business_category: null,
      last_post_at: recentDate(120),
      external_url: 'https://mybrand.com',
    })
    const features = extractFeatures(profile, null, 'own_site')
    const { score } = computeScore(features, SEED_WEIGHTS)
    expect(score).toBeLessThan(30)
  })
})

describe('loadProductionWeights', () => {
  it('throws when no production weights row exists', async () => {
    const supabase = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      }),
    }
    await expect(loadProductionWeights(supabase)).rejects.toThrow('no production weights found')
  })

  it('returns weights record when production row exists', async () => {
    const mockRow = { id: 'abc', version: 1, status: 'production', weights: SEED_WEIGHTS }
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: mockRow, error: null }) }),
        }),
      }),
    }
    const result = await loadProductionWeights(supabase)
    expect(result.version).toBe(1)
    expect(result.weights['bias']).toBe(-2.5)
  })
})

describe('scoreAndPersist', () => {
  it('skips history insert when leadId is null', async () => {
    const insertMock = jest.fn()
    const supabase = {
      from: (table: string) => {
        if (table === 'scoring_weights') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: '1', version: 1, status: 'production', weights: SEED_WEIGHTS },
                  error: null,
                }),
              }),
            }),
          }
        }
        return { insert: insertMock }
      },
    }
    const profile = baseProfile({ followers_count: 1000 })
    await scoreAndPersist(supabase, null, profile, null, 'no_link')
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('inserts history row when leadId is provided', async () => {
    const insertMock = jest.fn().mockResolvedValue({ error: null })
    const supabase = {
      from: (table: string) => {
        if (table === 'scoring_weights') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: '1', version: 1, status: 'production', weights: SEED_WEIGHTS },
                  error: null,
                }),
              }),
            }),
          }
        }
        return { insert: insertMock }
      },
    }
    const profile = baseProfile({ followers_count: 1000 })
    await scoreAndPersist(supabase, 'lead-uuid', profile, null, 'no_link')
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ lead_id: 'lead-uuid', weights_version: 1 }),
    )
  })
})
