const DEFAULT_KEYWORDS = [
  'yo sigo',
  'tomo yo',
  'no respondas mas',
  'no respondas más',
  'me encargo yo',
  'te respondo yo',
  'soy la dueña',
  'soy el dueño',
  'respondo yo',
  'continuo yo',
  'continúo yo',
  'paro el bot',
  'detene el bot',
  'para el bot',
  'no sigas',
  'me encargo',
  'ya respondo yo',
]

function loadKeywords(): string[] {
  const envKeywords = process.env.OWNER_TAKEOVER_KEYWORDS
  if (!envKeywords) return DEFAULT_KEYWORDS

  const fromEnv = envKeywords.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean)
  // Merge env keywords with defaults so both sets apply
  const merged = DEFAULT_KEYWORDS.concat(fromEnv)
  return merged.filter((kw, idx) => merged.indexOf(kw) === idx)
}

// Normalize: lowercase, remove accents, collapse whitespace
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/\s+/g, ' ')
    .trim()
}

export function isOwnerTakeover(text: string): boolean {
  const normalized = normalize(text)
  const keywords = loadKeywords().map(normalize)
  return keywords.some((kw) => normalized.includes(kw))
}
