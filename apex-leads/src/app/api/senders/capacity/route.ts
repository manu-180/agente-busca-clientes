import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { getCapacityStats } from '@/lib/sender-pool'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createSupabaseServer()
  try {
    const stats = await getCapacityStats(supabase)
    return NextResponse.json(stats)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Internal error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
