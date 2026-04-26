import { getDailyLimit } from '../ramp-up'

describe('getDailyLimit', () => {
  it('returns 5 on day 0', () => {
    expect(getDailyLimit(0)).toBe(5)
  })

  it('returns 30 on day 6 (capped)', () => {
    expect(getDailyLimit(6)).toBe(30)
  })

  it('returns 30 on day 10 (capped)', () => {
    expect(getDailyLimit(10)).toBe(30)
  })

  it('increments by 5 each day up to cap', () => {
    expect(getDailyLimit(1)).toBe(10)
    expect(getDailyLimit(2)).toBe(15)
    expect(getDailyLimit(3)).toBe(20)
    expect(getDailyLimit(4)).toBe(25)
    expect(getDailyLimit(5)).toBe(30)
  })
})
