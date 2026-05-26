import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

/**
 * Listado de info del agente para un proyecto.
 * Query: ?project_id=<uuid>  (obligatorio — sin él el bot no sabe de qué producto hablar).
 */
export async function GET(req: NextRequest) {
  const supabase = createSupabaseServer()
  const projectId = req.nextUrl.searchParams.get('project_id')
  if (!projectId) {
    return NextResponse.json({ error: 'Falta project_id' }, { status: 400 })
  }
  const { data, error } = await supabase
    .from('project_info')
    .select('*')
    .eq('project_id', projectId)
    .order('categoria', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ infos: data })
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer()
  const body = await req.json()
  if (!body?.project_id || typeof body.project_id !== 'string') {
    return NextResponse.json({ error: 'Falta project_id' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('project_info')
    .insert({
      project_id: body.project_id,
      categoria: body.categoria,
      titulo: body.titulo,
      contenido: body.contenido,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ info: data })
}

export async function PUT(req: NextRequest) {
  const supabase = createSupabaseServer()
  const body = await req.json()

  const { data, error } = await supabase
    .from('project_info')
    .update({
      categoria: body.categoria,
      titulo: body.titulo,
      contenido: body.contenido,
    })
    .eq('id', body.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ info: data })
}

export async function DELETE(req: NextRequest) {
  const supabase = createSupabaseServer()
  const body = await req.json()

  const { error } = await supabase
    .from('project_info')
    .delete()
    .eq('id', body.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
