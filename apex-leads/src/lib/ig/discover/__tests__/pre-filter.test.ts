import { preFilter, type RawLead } from '../pre-filter'

function make(overrides: Partial<Record<string, unknown>> = {}): RawLead {
  return {
    id: 'test-id',
    ig_username: 'testuser',
    raw_profile: { followersCount: 500, postsCount: 10, isPrivate: false, isVerified: false, ...overrides },
  }
}

const emptyBlacklist = new Set<string>()

describe('preFilter', () => {
  it('rejects private accounts', () => {
    expect(preFilter(make({ isPrivate: true }), emptyBlacklist)).toEqual({ keep: false, reason: 'private' })
  })

  it('rejects verified accounts', () => {
    expect(preFilter(make({ isVerified: true }), emptyBlacklist)).toEqual({ keep: false, reason: 'verified' })
  })

  it('rejects low followers', () => {
    expect(preFilter(make({ followersCount: 150 }), emptyBlacklist)).toEqual({ keep: false, reason: 'low_followers' })
  })

  it('rejects too many followers', () => {
    expect(preFilter(make({ followersCount: 200_001 }), emptyBlacklist)).toEqual({ keep: false, reason: 'too_many_followers' })
  })

  it('rejects low posts', () => {
    expect(preFilter(make({ postsCount: 2 }), emptyBlacklist)).toEqual({ keep: false, reason: 'low_posts' })
  })

  it('rejects blacklisted username', () => {
    const bl = new Set(['testuser'])
    expect(preFilter(make(), bl)).toEqual({ keep: false, reason: 'blacklisted' })
  })

  it('blacklist check is case-insensitive for ig_username', () => {
    // loadBlacklist always returns lowercase keys; username match should still work
    // even if ig_username arrives with mixed case
    const raw: RawLead = { ...make(), ig_username: 'TestUser' }
    const bl = new Set(['testuser'])
    expect(preFilter(raw, bl)).toEqual({ keep: false, reason: 'blacklisted' })
  })

  it('passes a valid lead', () => {
    expect(preFilter(make(), emptyBlacklist)).toEqual({ keep: true })
  })

  it('passes a lead with missing followers/posts (sidecar rows without full profile)', () => {
    const raw: RawLead = { id: 'x', ig_username: 'nodata', raw_profile: {} }
    expect(preFilter(raw, emptyBlacklist)).toEqual({ keep: true })
  })
})
