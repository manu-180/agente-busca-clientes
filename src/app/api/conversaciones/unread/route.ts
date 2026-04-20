import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

export async function GET() {
  const supabase = createSupabaseServer()

  const { count, error } = await supabase
    .from('conversaciones')
    .select('*', { count: 'exact', head: true })
    .eq('leido', false)
    .eq('rol', 'cliente')

  if (error) return NextResponse.json({ total: 0 })

  return NextResponse.json({ total: count ?? 0 })
}
