export const RAMP_START_DATE: Date | null = (() => {
  const raw = process.env.IG_RAMP_START
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
})()

export function getDailyLimit(daysSinceLaunch: number): number {
  return Math.min(5 + daysSinceLaunch * 5, 30)
}
