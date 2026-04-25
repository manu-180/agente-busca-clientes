import { createHash } from 'crypto'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { igConfig } from '../config'
import { NICHE_SYSTEM_PROMPT, buildUserPrompt } from './prompts'
import type { ProfileData } from '../sidecar'
import { sendAlert } from '../alerts/discord'

// ── Types ────────────────────────────────────────────────────────────────────

export const NICHE_VALUES = [
  'moda_femenina',
  'moda_masculina',
  'indumentaria_infantil',
  'accesorios',
  'calzado',
  'belleza_estetica',
  'joyeria',
  'otro',
  'descartar',
] as const

export type Niche = (typeof NICHE_VALUES)[number]

const ClassificationSchema = z.object({
  niche: z.enum(NICHE_VALUES),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(120),
})

export type ClassificationResult = z.infer<typeof ClassificationSchema>

// Estimated cost per Haiku call (input ~400 tokens + output ~50 tokens)
const COST_PER_CALL_USD = 0.00015
const DAILY_SPEND_ALERT_USD = 1.0

// ── Helpers ──────────────────────────────────────────────────────────────────

export function promptHash(p: ProfileData): string {
  const key = `${p.biography ?? ''}|${p.business_category ?? ''}|${p.full_name ?? ''}`
  return createHash('sha256').update(key).digest('hex').slice(0, 32)
}

function parseJsonLoose(text: string): unknown {
  const stripped = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim()
  return JSON.parse(stripped)
}

// ── Cache ────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getCached(supabase: any, igUsername: string, hash: string): Promise<ClassificationResult | null> {
  const { data } = await supabase
    .from('niche_classifications')
    .select('niche, confidence, reason, prompt_hash')
    .eq('ig_username', igUsername)
    .gt('expires_at', new Date().toISOString())
    .order('classified_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (data && data.prompt_hash === hash) {
    const parsed = ClassificationSchema.safeParse(data)
    if (parsed.success) return parsed.data
  }
  return null
}

// ── Anthropic call ───────────────────────────────────────────────────────────

let _client: Anthropic | null = null
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: igConfig.ANTHROPIC_API_KEY })
  return _client
}

async function callClaudeRaw(profile: ProfileData): Promise<string> {
  const resp = await getClient().messages.create({
    model: igConfig.CLAUDE_HAIKU_MODEL,
    max_tokens: 200,
    system: NICHE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(profile) }],
  })
  return resp.content[0].type === 'text' ? resp.content[0].text : ''
}

async function callClaude(profile: ProfileData): Promise<ClassificationResult> {
  const text = await callClaudeRaw(profile)
  try {
    return ClassificationSchema.parse(parseJsonLoose(text))
  } catch {
    // Retry once on parse failure
    const text2 = await callClaudeRaw(profile)
    return ClassificationSchema.parse(parseJsonLoose(text2))
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function classifyNiche(supabase: any, profile: ProfileData): Promise<ClassificationResult> {
  const hash = promptHash(profile)
  const cached = await getCached(supabase, profile.ig_username, hash)
  if (cached) return cached

  const result = await callClaude(profile)

  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 30)

  await supabase.from('niche_classifications').insert({
    ig_username: profile.ig_username,
    niche: result.niche,
    confidence: result.confidence,
    reason: result.reason,
    classifier: igConfig.CLAUDE_HAIKU_MODEL,
    prompt_hash: hash,
    expires_at: expiresAt.toISOString(),
  })

  return result
}

/**
 * Check today's classification spend and insert a warning in alerts_log if > $1.
 * Deduped: inserts at most one alert per day.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function checkDailyCostAlert(supabase: any): Promise<void> {
  const todayStr = new Date().toISOString().slice(0, 10)
  const todayStart = `${todayStr}T00:00:00.000Z`

  const { count } = await supabase
    .from('niche_classifications')
    .select('id', { count: 'exact', head: true })
    .gte('classified_at', todayStart)

  const estimatedSpend = (count ?? 0) * COST_PER_CALL_USD
  if (estimatedSpend < DAILY_SPEND_ALERT_USD) return

  // Check if alert already exists today
  const { data: existing } = await supabase
    .from('alerts_log')
    .select('id')
    .eq('source', 'niche_classifier')
    .gte('triggered_at', todayStart)
    .limit(1)
    .maybeSingle()

  if (existing) return

  await sendAlert(
    supabase,
    'warning',
    'niche_classifier',
    `Daily classification spend ~$${estimatedSpend.toFixed(3)} (${count} calls). Review if unexpected.`,
    { count, estimated_spend_usd: estimatedSpend, date: todayStr },
  )
}
