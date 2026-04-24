import { classifyLink, isTargetLead, type IgProfile } from '@/lib/ig/classify'
import { scoreLead } from '@/lib/ig/score'

// ── classifyLink ──────────────────────────────────────────────────────────────

describe('classifyLink', () => {
  it('returns no_link for empty/null', () => {
    expect(classifyLink(null)).toBe('no_link')
    expect(classifyLink('')).toBe('no_link')
    expect(classifyLink(undefined)).toBe('no_link')
  })

  it('detects aggregators', () => {
    expect(classifyLink('https://linktr.ee/mi_boutique')).toBe('aggregator')
    expect(classifyLink('https://beacons.ai/mi_boutique')).toBe('aggregator')
    expect(classifyLink('carrd.co/sitio')).toBe('aggregator')
  })

  it('detects social/dm-only links', () => {
    expect(classifyLink('https://wa.me/5491112345678')).toBe('social_only')
    expect(classifyLink('https://www.instagram.com/mi_boutique')).toBe('social_only')
    expect(classifyLink('https://m.me/mi_pagina')).toBe('social_only')
  })

  it('detects marketplace platforms', () => {
    expect(classifyLink('https://miboutique.tiendanube.com')).toBe('marketplace')
    expect(classifyLink('https://mitiendanube.com/tienda')).toBe('marketplace')
    expect(classifyLink('https://mi-tienda.shopify.com')).toBe('marketplace')
    expect(classifyLink('https://miboutique.wixsite.com/home')).toBe('marketplace')
  })

  it('detects own site domains', () => {
    expect(classifyLink('https://miboutique.com.ar')).toBe('own_site')
    expect(classifyLink('https://laboutique.com')).toBe('own_site')
    expect(classifyLink('https://tienda.shop')).toBe('own_site')
    expect(classifyLink('https://moda.store')).toBe('own_site')
  })

  it('returns unknown for unrecognized domains', () => {
    expect(classifyLink('https://algundominio-raro.xyz')).toBe('unknown')
  })
})

// ── isTargetLead ──────────────────────────────────────────────────────────────

const baseProfile: IgProfile = {
  ig_username: 'laboutique_ba',
  biography: 'Boutique de ropa de mujer. Envíos a todo el país.',
  external_url: 'https://wa.me/5491112345678',
  followers_count: 3200,
  posts_count: 180,
  is_private: false,
  is_verified: false,
  is_business: true,
  business_category: 'Boutique',
}

describe('isTargetLead', () => {
  it('qualifies a typical boutique without own site', () => {
    expect(isTargetLead(baseProfile)).toBe(true)
  })

  it('disqualifies private accounts', () => {
    expect(isTargetLead({ ...baseProfile, is_private: true })).toBe(false)
  })

  it('disqualifies verified accounts', () => {
    expect(isTargetLead({ ...baseProfile, is_verified: true })).toBe(false)
  })

  it('disqualifies accounts with too few followers', () => {
    expect(isTargetLead({ ...baseProfile, followers_count: 100 })).toBe(false)
  })

  it('disqualifies accounts with own website', () => {
    expect(isTargetLead({ ...baseProfile, external_url: 'https://miboutique.com.ar' })).toBe(false)
  })

  it('disqualifies mayoristas/revendedoras', () => {
    expect(isTargetLead({ ...baseProfile, biography: 'Venta mayorista de ropa' })).toBe(false)
    expect(isTargetLead({ ...baseProfile, biography: 'Revendedora oficial' })).toBe(false)
  })

  it('qualifies account with aggregator link (no own site)', () => {
    expect(isTargetLead({ ...baseProfile, external_url: 'https://linktr.ee/boutique_ba' })).toBe(true)
  })
})

// ── scoreLead ─────────────────────────────────────────────────────────────────

describe('scoreLead', () => {
  it('gives high score to ideal boutique', () => {
    const { score, breakdown } = scoreLead({
      ...baseProfile,
      last_post_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
      posts_last_30d: 10,
      followers_count: 4500,
    })
    expect(score).toBeGreaterThan(50)
    expect(breakdown.whatsapp_signals).toBe(10) // has wa.me link
    expect(breakdown.recency).toBe(20)
  })

  it('gives low score to inactive account with no signals', () => {
    const { score } = scoreLead({
      biography: 'Ropa y accesorios',
      external_url: null,
      bio_links: [],
      followers_count: 300,
      posts_count: 10,
      is_business: false,
      last_post_at: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(), // 4 months ago
      posts_last_30d: 0,
    })
    expect(score).toBeLessThan(30)
  })

  it('penalizes own_site verdict', () => {
    const { breakdown } = scoreLead({
      ...baseProfile,
      external_url: 'https://miboutique.com.ar',
    })
    expect(breakdown.link_verdict).toBe(-20)
  })

  it('rewards no_link verdict', () => {
    const { breakdown } = scoreLead({
      ...baseProfile,
      external_url: null,
      bio_links: [],
    })
    expect(breakdown.link_verdict).toBe(5)
  })

  it('score is always in 0–100 range', () => {
    const { score } = scoreLead({
      biography: 'mayorista revendedora influencer coach',
      external_url: 'https://miboutique.com.ar',
      followers_count: 500,
      posts_last_30d: 0,
    })
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })
})
