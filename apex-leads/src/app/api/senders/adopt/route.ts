import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import {
  buildWebhookUrl,
  fetchPhoneNumber,
  getInstanceState,
  setWebhook,
} from '@/lib/evolution-instance'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer()
  const body = await req.json().catch(() => null)
  const instance_name = body?.instance_name as string | undefined
  const alias = body?.alias as string | undefined
  const daily_limit = Number(body?.daily_limit ?? 15)
  const color = (body?.color as string | undefined) ?? '#84cc16'

  if (!instance_name || !alias) {
    return NextResponse.json({ error: 'instance_name y alias requeridos' }, { status: 400 })
  }

  // Evitar duplicados
  const { data: existing } = await supabase
    .from('senders')
    .select('id')
    .eq('provider', 'evolution')
    .eq('instance_name', instance_name)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ error: 'ya existe un sender con ese instance_name' }, { status: 409 })
  }

  try {
    const [state, phone] = await Promise.all([
      getInstanceState(instance_name).catch(() => 'unknown' as const),
      fetchPhoneNumber(instance_name).catch(() => null),
    ])

    // Garantizar webhook configurado a nuestro endpoint
    try {
      await setWebhook(instance_name, buildWebhookUrl())
    } catch (err) {
      console.warn('[adopt] setWebhook fallo (no-bloqueante):', err)
    }

    const isOpen = state === 'open'
    const insertPayload = {
      provider: 'evolution',
      instance_name,
      alias,
      phone_number: phone ?? '',
      daily_limit: Number.isFinite(daily_limit) && daily_limit > 0 ? Math.floor(daily_limit) : 15,
      color,
      connected: isOpen,
      connected_at: isOpen ? new Date().toISOString() : null,
      activo: true,
    }

    const { data: inserted, error } = await supabase
      .from('senders')
      .insert(insertPayload)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ sender: inserted })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/senders/adopt] error', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
