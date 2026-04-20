import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = createSupabaseServer()

  const cronName = req.nextUrl.searchParams.get('cron') ?? undefined
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '100'), 200)

  let query = supabase
    .from('cron_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit)

  if (cronName) {
    query = query.eq('cron_name', cronName)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ runs: data })
}
