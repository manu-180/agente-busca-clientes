import { sampleBeta, thompsonPick, renderTemplate, type TemplateStat, type Template } from '../selector'

describe('sampleBeta', () => {
  it('returns 0–1', () => {
    for (let i = 0; i < 100; i++) {
      const v = sampleBeta(2, 5)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
  it('Beta(1,1) mean ~0.5', () => {
    let sum = 0
    for (let i = 0; i < 5000; i++) sum += sampleBeta(1, 1)
    expect(sum / 5000).toBeCloseTo(0.5, 1)
  })
})

describe('thompsonPick', () => {
  it('throws on empty', () => {
    expect(() => thompsonPick([])).toThrow('no active templates')
  })
  it('favors higher CTR template (>70% of 1000 picks)', () => {
    const stats: TemplateStat[] = [
      { template_id: 'A', name: 'A', status: 'active', sends: 30, replies: 9, ctr_pct: 30, beta_alpha: 10, beta_beta: 22 },
      { template_id: 'B', name: 'B', status: 'active', sends: 5, replies: 0, ctr_pct: 0, beta_alpha: 1, beta_beta: 6 },
    ]
    const wins = Array.from({ length: 1000 }).filter(() => thompsonPick(stats).template_id === 'A').length
    expect(wins).toBeGreaterThan(700)
  })
  it('both templates get chances when equal priors', () => {
    const stats: TemplateStat[] = [
      { template_id: 'X', name: 'X', status: 'active', sends: 0, replies: 0, ctr_pct: 0, beta_alpha: 1, beta_beta: 1 },
      { template_id: 'Y', name: 'Y', status: 'active', sends: 0, replies: 0, ctr_pct: 0, beta_alpha: 1, beta_beta: 1 },
    ]
    const xWins = Array.from({ length: 1000 }).filter(() => thompsonPick(stats).template_id === 'X').length
    expect(xWins).toBeGreaterThan(300)
    expect(xWins).toBeLessThan(700)
  })
})

describe('renderTemplate', () => {
  const tpl: Template = {
    id: 'abc', name: 'test',
    body: 'Hola {first_name}, rubro {niche}.',
    variables: ['first_name', 'niche'], status: 'active',
  }
  it('substitutes vars', () => {
    expect(renderTemplate(tpl, { first_name: 'Ana', niche: 'moda' })).toBe('Hola Ana, rubro moda.')
  })
  it('missing var → empty string', () => {
    expect(renderTemplate(tpl, { first_name: 'Ana' })).toBe('Hola Ana, rubro .')
  })
})
