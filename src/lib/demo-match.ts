import { normalizeTextForMatch } from './demo-normalize'

export interface DemoRubro {
  id: string
  slug: string
  rubro_label: string
  url: string
  strong_keywords: string[]
  weak_keywords: string[]
  negative_keywords: string[]
  active: boolean
  priority: number
}

export interface MatchReason {
  strongHits: string[]
  weakHits: string[]
  negativeHits: string[]
}

export interface MatchResult {
  demo: DemoRubro | null
  score: number
  reason: MatchReason
}

const STRONG_THRESHOLD = 100
const STRONG_HIT = 100
const WEAK_HIT = 50
const MIN_GAP = 30

function buildWordBoundaryRegex(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`, 'i')
}

export function matchDemoFromTexts(
  demos: DemoRubro[],
  {
    rubroGuardado,
    textos,
  }: {
    rubroGuardado?: string | null
    textos?: string[]
  }
): MatchResult {
  const reason: MatchReason = { strongHits: [], weakHits: [], negativeHits: [] }

  if (!demos.length) {
    return { demo: null, score: 0, reason }
  }

  const allTextRaw = [
    rubroGuardado ?? '',
    ...(textos ?? []),
  ]
    .filter(Boolean)
    .join(' ')

  const normalized = normalizeTextForMatch(allTextRaw)
  if (!normalized) {
    return { demo: null, score: 0, reason }
  }

  const scores = demos
    .filter((d) => d.active)
    .map((demo) => {
      let score = 0
      const localReason: MatchReason = { strongHits: [], weakHits: [], negativeHits: [] }

      for (const kw of demo.negative_keywords || []) {
        const re = buildWordBoundaryRegex(kw.toLowerCase())
        if (re.test(normalized)) {
          localReason.negativeHits.push(kw)
        }
      }

      if (localReason.negativeHits.length) {
        return { demo, score: 0, reason: localReason }
      }

      for (const kw of demo.strong_keywords || []) {
        const re = buildWordBoundaryRegex(kw.toLowerCase())
        if (re.test(normalized)) {
          score += STRONG_HIT
          localReason.strongHits.push(kw)
        }
      }

      for (const kw of demo.weak_keywords || []) {
        const re = buildWordBoundaryRegex(kw.toLowerCase())
        if (re.test(normalized)) {
          score += WEAK_HIT
          localReason.weakHits.push(kw)
        }
      }

      return { demo, score, reason: localReason }
    })

  scores.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return (b.demo.priority ?? 0) - (a.demo.priority ?? 0)
  })

  const best = scores[0]
  const second = scores[1]

  if (!best || best.score < STRONG_THRESHOLD) {
    return { demo: null, score: 0, reason }
  }

  const gap = second ? best.score - second.score : best.score
  if (gap < MIN_GAP) {
    return { demo: null, score: 0, reason }
  }

  return {
    demo: best.demo,
    score: best.score,
    reason: best.reason,
  }
}

