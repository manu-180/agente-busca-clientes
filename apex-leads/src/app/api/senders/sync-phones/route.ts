import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { fetchAllInstances } from '@/lib/evolution-instance'

export const dynamic = 'force-dynamic'

export async function POST() {
  const supabase = createSupabaseServer()

  const { data: senders, error } = await supabase
    .from('senders')
    .select('id, instance_name, phone_number')
    .eq('provider', 'evolution')
    .eq('connected', true)
    .like('phone_number', '_pending_%')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!senders?.length) return NextResponse.json({ updated: 0 })

  let instances: Awaited<ReturnType<typeof fetchAllInstances>>
  try {
    instances = await fetchAllInstances()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  const phoneMap = new Map(instances.map(i => [i.name, i.phone]))

  let updated = 0
  for (const sender of senders) {
    if (!sender.instance_name) continue
    const phone = phoneMap.get(sender.instance_name)
    if (phone) {
      await supabase.from('senders').update({ phone_number: phone }).eq('id', sender.id)
      updated++
    }
  }

  return NextResponse.json({ updated })
}
