import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { fetchAllInstances, deleteInstance } from '@/lib/evolution-instance'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createSupabaseServer()

  try {
    const [evolutionInstances, dbResult] = await Promise.all([
      fetchAllInstances(),
      supabase.from('senders').select('instance_name').eq('provider', 'evolution'),
    ])

    if (dbResult.error) {
      return NextResponse.json({ error: dbResult.error.message }, { status: 500 })
    }

    const known = new Set(
      (dbResult.data ?? [])
        .map(s => s.instance_name)
        .filter((n): n is string => typeof n === 'string' && n.length > 0)
    )

    const orphans = evolutionInstances.filter(i => !known.has(i.name))
    return NextResponse.json({ orphans })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/senders/orphans] error', msg)
    return NextResponse.json({ error: msg, orphans: [] }, { status: 502 })
  }
}

// DELETE /api/senders/orphans?name=wa-xxx → borra la instancia en Evolution.
// Solo opera si NO existe sender con ese instance_name (sino es un sender real).
export async function DELETE(req: Request) {
  const supabase = createSupabaseServer()
  const { searchParams } = new URL(req.url)
  const name = searchParams.get('name')
  if (!name) return NextResponse.json({ error: 'name requerido' }, { status: 400 })

  const { data: existing } = await supabase
    .from('senders')
    .select('id')
    .eq('provider', 'evolution')
    .eq('instance_name', name)
    .maybeSingle()

  if (existing) {
    return NextResponse.json(
      { error: 'esta instancia ya está vinculada a un sender, no es huérfana' },
      { status: 409 }
    )
  }

  try {
    await deleteInstance(name)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
