import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { cargarProyectoPorSlug } from '@/lib/projects'

export const dynamic = 'force-dynamic'

const ALLOWED_FIELDS = new Set([
  'nombre',
  'descripcion',
  'url_publica',
  'filtro_sin_web',
  'rubros_sugeridos',
  'plantilla_primer_mensaje',
])

export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  const supabase = createSupabaseServer()
  const project = await cargarProyectoPorSlug(supabase, params.slug)
  if (!project) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  return NextResponse.json({ project })
}

export async function PATCH(req: NextRequest, { params }: { params: { slug: string } }) {
  const supabase = createSupabaseServer()
  const body = await req.json()
  const safe: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED_FIELDS.has(k)) safe[k] = v
  }
  if (Object.keys(safe).length === 0) {
    return NextResponse.json({ error: 'Sin cambios válidos' }, { status: 400 })
  }
  safe.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('projects')
    .update(safe)
    .eq('slug', params.slug)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ project: data })
}
