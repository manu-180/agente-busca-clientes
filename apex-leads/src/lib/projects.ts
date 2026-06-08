/**
 * Helpers para cargar proyectos. Cada lead pertenece a un único proyecto
 * (APEX, Assistify, Handy, botlode) y el bot usa SOLO la info del proyecto
 * del lead al responder — nunca mezcla contexto entre productos.
 */
import type { Database } from '@/types/supabase'
import { createTtlCache } from '@/lib/ttl-cache'

export type ProjectRow = Database['public']['Tables']['projects']['Row']

/**
 * Los proyectos cambian rara vez pero se leen en CADA mensaje entrante (routing
 * + construcción del prompt). Cacheamos por id y por slug con TTL corto para no
 * golpear Supabase en cada webhook. TTL configurable vía env (default 5 min).
 */
const PROJECT_TTL_MS = Number(process.env.PROJECT_CACHE_TTL_MS ?? 5 * 60_000)
const projectCache = createTtlCache<ProjectRow>(PROJECT_TTL_MS)

/**
 * Slug del proyecto por defecto. Lo usan los flujos donde el lead no vino de
 * una búsqueda explícita (webhook entrante con teléfono desconocido, POST manual
 * a /api/leads sin project_id, etc.). APEX es el proyecto fundacional del programa.
 */
export const DEFAULT_PROJECT_SLUG = 'apex'

// El cliente de Supabase en este proyecto no está tipado con Database, así que
// aceptamos cualquier instancia y casteamos el resultado a ProjectRow.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any

export async function cargarProyectoPorId(
  supabase: AnySupabase,
  projectId: string
): Promise<ProjectRow | null> {
  const ck = `id:${projectId}`
  const hit = projectCache.get(ck)
  if (hit) return hit

  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single()
  if (error) {
    console.warn('[projects] cargarProyectoPorId error:', error.message)
    return null
  }
  const row = data as ProjectRow
  projectCache.set(ck, row)
  if (row?.slug) projectCache.set(`slug:${row.slug}`, row)
  return row
}

export async function cargarProyectoPorSlug(
  supabase: AnySupabase,
  slug: string
): Promise<ProjectRow | null> {
  const ck = `slug:${slug}`
  const hit = projectCache.get(ck)
  if (hit) return hit

  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('slug', slug)
    .single()
  if (error) {
    console.warn('[projects] cargarProyectoPorSlug error:', error.message)
    return null
  }
  const row = data as ProjectRow
  projectCache.set(ck, row)
  if (row?.id) projectCache.set(`id:${row.id}`, row)
  return row
}

export async function cargarProyectoApexDefault(
  supabase: AnySupabase
): Promise<ProjectRow | null> {
  return cargarProyectoPorSlug(supabase, DEFAULT_PROJECT_SLUG)
}

export async function listarProyectosActivos(
  supabase: AnySupabase
): Promise<ProjectRow[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('activo', true)
    .order('orden', { ascending: true })
  if (error) {
    console.warn('[projects] listarProyectosActivos error:', error.message)
    return []
  }
  return (data ?? []) as ProjectRow[]
}

/**
 * True si el proyecto es de uso gratuito (se deduce de su `descripcion`).
 * Misma heurística que usa el system prompt para activar la regla "es gratis".
 */
export function esProyectoGratis(project: ProjectRow): boolean {
  return /gratuit|gratis/i.test((project.descripcion ?? '').trim())
}

/**
 * Primer link http(s) que aparece en la plantilla del primer mensaje del proyecto.
 * En productos self-serve (Assistify, etc.) ese link es el de descarga/acceso, y es
 * el "próximo paso" al que todas las respuestas deben empujar. Devuelve null si no hay.
 */
export function linkDescargaProyecto(project: ProjectRow): string | null {
  const m = (project.plantilla_primer_mensaje ?? '').match(/https?:\/\/[^\s)]+/i)
  return m ? m[0].replace(/[.,;]+$/, '') : null
}

/** Filas activas de `project_info` (knowledge base que el agente cita). */
export type ProjectInfoRow = { categoria: string; titulo: string; contenido: string }

const PROJECT_INFO_TTL_MS = Number(process.env.PROJECT_INFO_CACHE_TTL_MS ?? 5 * 60_000)
const projectInfoCache = createTtlCache<ProjectInfoRow[]>(PROJECT_INFO_TTL_MS)

/**
 * Knowledge base activa de un proyecto, cacheada con TTL. Se lee en cada
 * respuesta del agente (full_reply) y es el payload de texto más pesado después
 * del historial; cambia rara vez, así que cachearla recorta mucho egress.
 */
export async function cargarProjectInfoActivo(
  supabase: AnySupabase,
  projectId: string
): Promise<ProjectInfoRow[]> {
  const ck = `pinfo:${projectId}`
  const hit = projectInfoCache.get(ck)
  if (hit) return hit

  const { data, error } = await supabase
    .from('project_info')
    .select('categoria, titulo, contenido')
    .eq('project_id', projectId)
    .eq('activo', true)
  if (error) {
    console.warn('[projects] cargarProjectInfoActivo error:', error.message)
    return []
  }
  const rows = (data ?? []) as ProjectInfoRow[]
  projectInfoCache.set(ck, rows)
  return rows
}
