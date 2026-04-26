import type { ProfileData } from '../sidecar'
import type { ClassificationResult } from '../classify/niche'
import { extractFeatures, type Features } from './features'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = any

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z))

export interface WeightsRecord {
  id: string
  version: number
  status: string
  weights: Record<string, number>
}

export async function loadProductionWeights(supabase: Supabase): Promise<WeightsRecord> {
  const { data, error } = await supabase
    .from('scoring_weights')
    .select('*')
    .eq('status', 'production')
    .maybeSingle()
  if (error || !data) {
    throw new Error('no production weights found — seed scoring_weights first')
  }
  return data as WeightsRecord
}

export function computeScore(
  features: Features,
  weights: Record<string, number>,
): { score: number; z: number } {
  let z = weights['bias'] ?? 0
  for (const k of Object.keys(features) as (keyof Features)[]) {
    z += (weights[k] ?? 0) * features[k]
  }
  const score = Math.round(sigmoid(z) * 100)
  return { score, z }
}

export async function scoreAndPersist(
  supabase: Supabase,
  leadId: string | null,
  profile: ProfileData,
  niche: ClassificationResult | null,
  linkVerdict: string,
  cachedWeights?: WeightsRecord,
): Promise<{ score: number; features: Features; version: number }> {
  const w = cachedWeights ?? (await loadProductionWeights(supabase))
  const features = extractFeatures(profile, niche, linkVerdict)
  const { score } = computeScore(features, w.weights)

  if (leadId) {
    await supabase.from('lead_score_history').insert({
      lead_id: leadId,
      weights_version: w.version,
      score,
      features,
    })
  }

  return { score, features, version: w.version }
}
