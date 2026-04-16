import { createSupabaseServer } from './supabase-server'
import type { DemoRubro } from './demo-match'

type DemoPayload = Omit<DemoRubro, 'id' | 'active' | 'priority'> & {
  id?: string
  active?: boolean
  priority?: number
}

function normalizeKeywords(list?: string[] | null): string[] {
  if (!list) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of list) {
    const value = raw.trim().toLowerCase()
    if (!value) continue
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

function validateUrl(url: string): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    return u.protocol === 'https:'
  } catch {
    return false
  }
}

export async function listDemos(options?: { includeInactive?: boolean }): Promise<DemoRubro[]> {
  const supabase = createSupabaseServer()
  let query = supabase.from('demos_rubro').select('*')

  if (!options?.includeInactive) {
    query = query.eq('active', true)
  }

  const { data, error } = await query.order('priority', { ascending: false }).order('created_at', {
    ascending: false,
  })

  if (error || !data) {
    console.error('[DEMOS] Error listando demos:', error?.message)
    return []
  }

  return data as DemoRubro[]
}

export async function createDemo(input: DemoPayload): Promise<{ ok: boolean; error?: string }> {
  const supabase = createSupabaseServer()

  if (!input.slug || !input.slug.trim()) {
    return { ok: false, error: 'Slug requerido' }
  }
  if (!input.rubro_label || !input.rubro_label.trim()) {
    return { ok: false, error: 'Rubro requerido' }
  }
  if (!validateUrl(input.url)) {
    return { ok: false, error: 'URL inválida, debe empezar con https://' }
  }

  const strong = normalizeKeywords(input.strong_keywords)
  const weak = normalizeKeywords(input.weak_keywords)
  const negative = normalizeKeywords(input.negative_keywords)

  const { error } = await supabase.from('demos_rubro').insert({
    slug: input.slug.trim().toLowerCase(),
    rubro_label: input.rubro_label.trim(),
    url: input.url.trim(),
    strong_keywords: strong,
    weak_keywords: weak,
    negative_keywords: negative,
    active: input.active ?? true,
    priority: input.priority ?? 0,
  })

  if (error) {
    console.error('[DEMOS] Error creando demo:', error.message)
    return { ok: false, error: 'No se pudo crear la demo' }
  }

  return { ok: true }
}

export async function updateDemo(
  id: string,
  input: Partial<DemoPayload>
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createSupabaseServer()

  const patch: Record<string, unknown> = {}

  if (input.slug !== undefined) patch.slug = input.slug.trim().toLowerCase()
  if (input.rubro_label !== undefined) patch.rubro_label = input.rubro_label.trim()
  if (input.url !== undefined) {
    if (!validateUrl(input.url)) {
      return { ok: false, error: 'URL inválida, debe empezar con https://' }
    }
    patch.url = input.url.trim()
  }
  if (input.strong_keywords !== undefined) {
    patch.strong_keywords = normalizeKeywords(input.strong_keywords)
  }
  if (input.weak_keywords !== undefined) {
    patch.weak_keywords = normalizeKeywords(input.weak_keywords)
  }
  if (input.negative_keywords !== undefined) {
    patch.negative_keywords = normalizeKeywords(input.negative_keywords)
  }
  if (input.active !== undefined) patch.active = input.active
  if (input.priority !== undefined) patch.priority = input.priority

  const { error } = await supabase.from('demos_rubro').update(patch).eq('id', id)

  if (error) {
    console.error('[DEMOS] Error actualizando demo:', error.message)
    return { ok: false, error: 'No se pudo actualizar la demo' }
  }

  return { ok: true }
}

export async function deleteDemo(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = createSupabaseServer()

  const { error } = await supabase.from('demos_rubro').delete().eq('id', id)

  if (error) {
    console.error('[DEMOS] Error eliminando demo:', error.message)
    return { ok: false, error: 'No se pudo eliminar la demo' }
  }

  return { ok: true }
}

