import { z } from 'zod'

const BUILD = process.env.NEXT_PHASE === 'phase-production-build'

// Coerce env strings "true"/"1" to boolean, with explicit default when absent
const boolEnv = (dflt: boolean) =>
  z.preprocess((v) => {
    if (v === undefined || v === '') return dflt
    return v === 'true' || v === '1'
  }, z.boolean())

// Coerce env strings to positive integer, fall back to default on NaN or absence
const intEnv = (dflt: number) =>
  z.preprocess((v) => {
    if (v === undefined || v === '') return dflt
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : dflt
  }, z.number().int().positive())

const schema = z.object({
  // ── Required at runtime ──────────────────────────────────────────────
  IG_SIDECAR_URL: z.string().url(),
  IG_SIDECAR_SECRET: z.string().min(32),
  IG_SENDER_USERNAME: z.string().min(1),
  APIFY_TOKEN: z.string().min(1),
  APIFY_WEBHOOK_SECRET: z.string().min(32),
  CRON_SECRET: z.string().min(32),
  // ── Validated with sensible defaults ─────────────────────────────────
  DRY_RUN: boolEnv(false),
  ANTHROPIC_API_KEY: z
    .string()
    .refine((v) => v.startsWith('sk-ant-'), { message: "must start with 'sk-ant-'" })
    .optional(),
  DAILY_DM_LIMIT: intEnv(3),
  FOLLOWUP_HOURS: intEnv(48),
  IG_WARMUP_MODE: boolEnv(false),
  DISCOVERY_ENABLED: boolEnv(true),
})

export type IgConfig = z.infer<typeof schema>

const BUILD_DEFAULTS: Record<string, string> = {
  IG_SIDECAR_URL: 'http://localhost:8000',
  IG_SIDECAR_SECRET: 'a'.repeat(32),
  IG_SENDER_USERNAME: '__build__',
  APIFY_TOKEN: '__build__',
  APIFY_WEBHOOK_SECRET: 'a'.repeat(32),
  CRON_SECRET: 'a'.repeat(32),
}

function loadConfig(): IgConfig {
  // Filter empty strings so BUILD_DEFAULTS aren't overridden by unset local env vars
  const nonEmptyEnv = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ''),
  )
  const input = BUILD ? { ...BUILD_DEFAULTS, ...nonEmptyEnv } : process.env

  const result = schema.safeParse(input)
  if (!result.success) {
    const issues = result.error.issues
      .map((e) => `  ${String(e.path[0])}: ${e.message}`)
      .join('\n')
    throw new Error(`[ig/config] Missing or invalid env vars:\n${issues}`)
  }
  return result.data
}

export const igConfig: IgConfig = loadConfig()
