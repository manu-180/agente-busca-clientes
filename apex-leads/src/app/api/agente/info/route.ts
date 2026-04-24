import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

export async function GET() {
  const supabase = createSupabaseServer()
  const { data, error } = await supabase
    .from('apex_info')
    .select('*')
    .order('categoria', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ infos: data })
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer()
  const body = await req.json()

  const { data, error } = await supabase
    .from('apex_info')
    .insert({
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
    .from('apex_info')
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
    .from('apex_info')
    .delete()
    .eq('id', body.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
