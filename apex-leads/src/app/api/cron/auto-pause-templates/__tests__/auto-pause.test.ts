import { betaCI95, findTemplatesToPause } from '@/lib/ig/templates/auto-pause'

describe('betaCI95', () => {
  it('Beta(2,2) mean 0.5 symmetric', () => {
    const { lo, hi, mean } = betaCI95(2, 2)
    expect(mean).toBeCloseTo(0.5)
    expect(hi - mean).toBeCloseTo(mean - lo, 2)
  })
})

describe('findTemplatesToPause', () => {
  it('returns empty with 1 eligible template', () => {
    expect(findTemplatesToPause([
      { template_id: 'A', name: 'A', status: 'active', sends: 200, replies: 40, beta_alpha: 41, beta_beta: 161 },
    ])).toEqual([])
  })

  it('pauses clearly dominated template (B dominated by C)', () => {
    // C: mean 0.30, lo ~0.21. B: mean 0.04, hi ~0.07 → hi_B < lo_C → pause B
    const stats = [
      { template_id: 'A', name: 'A', status: 'active', sends: 200, replies: 40, beta_alpha: 41, beta_beta: 161 },
      { template_id: 'B', name: 'B', status: 'active', sends: 150, replies: 5, beta_alpha: 6, beta_beta: 146 },
      { template_id: 'C', name: 'C', status: 'active', sends: 100, replies: 30, beta_alpha: 31, beta_beta: 71 },
    ]
    expect(findTemplatesToPause(stats)).toContain('B')
    expect(findTemplatesToPause(stats)).not.toContain('C')
  })

  it('skips templates with < 100 sends', () => {
    const stats = [
      { template_id: 'A', name: 'A', status: 'active', sends: 99, replies: 0, beta_alpha: 1, beta_beta: 100 },
      { template_id: 'B', name: 'B', status: 'active', sends: 99, replies: 50, beta_alpha: 51, beta_beta: 50 },
    ]
    expect(findTemplatesToPause(stats)).toEqual([])
  })

  it('ignores already-paused templates', () => {
    const stats = [
      { template_id: 'A', name: 'A', status: 'paused', sends: 200, replies: 0, beta_alpha: 1, beta_beta: 201 },
      { template_id: 'B', name: 'B', status: 'active', sends: 200, replies: 100, beta_alpha: 101, beta_beta: 101 },
    ]
    expect(findTemplatesToPause(stats)).toEqual([])
  })
})
