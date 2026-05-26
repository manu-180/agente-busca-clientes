/**
 * Helpers para cargar proyectos. Cada lead pertenece a un único proyecto
 * (APEX, Assistify, Handy, botlode) y el bot usa SOLO la info del proyecto
 * del lead al responder — nunca mezcla contexto entre productos.
 */
import type { Database } from '@/types/supabase'

export type ProjectRow = Database['public']['Tables']['projects']['Row']

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
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single()
  if (error) {
    console.warn('[projects] cargarProyectoPorId error:', error.message)
    return null
  }
  return data as ProjectRow
}

export async function cargarProyectoPorSlug(
  supabase: AnySupabase,
  slug: string
): Promise<ProjectRow | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('slug', slug)
    .single()
  if (error) {
    console.warn('[projects] cargarProyectoPorSlug error:', error.message)
    return null
  }
  return data as ProjectRow
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
