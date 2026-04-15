import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

export async function GET() {
  const supabase = createSupabaseServer()
  const { data } = await supabase.from('configuracion').select('*')

  const config: Record<string, string> = {}
  for (const row of data ?? []) {
    config[row.clave] = row.valor
  }

  return NextResponse.json(config)
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer()
  const body = await req.json()

  const { error } = await supabase
    .from('configuracion')
    .upsert({ clave: body.clave, valor: body.valor }, { onConflict: 'clave' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
