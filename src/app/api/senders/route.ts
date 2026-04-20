import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createSupabaseServer()
  const { data, error } = await supabase
    .from('senders')
    .select('*, conversaciones(count)')
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer()
  const body = await req.json()
  const { alias, provider, phone_number, descripcion, color } = body
  if (!alias || !provider || !phone_number) {
    return NextResponse.json({ error: 'alias, provider, phone_number requeridos' }, { status: 400 })
  }
  const { data, error } = await supabase
    .from('senders')
    .insert({ alias, provider, phone_number, descripcion, color: color ?? '#84cc16' })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const supabase = createSupabaseServer()
  const body = await req.json()
  const { id, ...updates } = body
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
  const { data, error } = await supabase
    .from('senders')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const supabase = createSupabaseServer()
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
  const { error } = await supabase.from('senders').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
