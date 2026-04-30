import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import {
  buildWebhookUrl,
  createInstance,
  deleteInstance,
  slugifyAlias,
} from '@/lib/evolution-instance'

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

async function generateUniqueInstanceName(
  supabase: ReturnType<typeof createSupabaseServer>,
  alias: string
): Promise<string> {
  const base = slugifyAlias(alias)
  // Reintentar hasta 5 veces buscando un slug libre.
  for (let i = 0; i < 5; i++) {
    const candidate = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 8)}`
    const { data } = await supabase
      .from('senders')
      .select('id')
      .eq('instance_name', candidate)
      .maybeSingle()
    if (!data) return candidate
  }
  // Fallback ultra-único
  return `${base}-${Date.now().toString(36)}`
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer()
  const body = await req.json().catch(() => ({}))
  const alias = body?.alias as string | undefined
  const provider = (body?.provider as string | undefined) ?? 'evolution'
  const phone_number = (body?.phone_number as string | undefined) ?? ''
  const descripcion = body?.descripcion as string | undefined
  const color = (body?.color as string | undefined) ?? '#84cc16'
  const daily_limit_raw = body?.daily_limit
  const daily_limit =
    daily_limit_raw !== undefined && Number.isFinite(Number(daily_limit_raw)) && Number(daily_limit_raw) > 0
      ? Math.floor(Number(daily_limit_raw))
      : 15

  if (!alias) {
    return NextResponse.json({ error: 'alias requerido' }, { status: 400 })
  }

  if (provider === 'evolution') {
    let instance_name: string
    try {
      instance_name = await generateUniqueInstanceName(supabase, alias)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: `slug error: ${msg}` }, { status: 500 })
    }

    try {
      await createInstance(instance_name, buildWebhookUrl())
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[POST /api/senders evolution] createInstance error:', msg)
      return NextResponse.json({ error: `createInstance: ${msg}` }, { status: 502 })
    }

    const { data, error } = await supabase
      .from('senders')
      .insert({
        provider: 'evolution',
        instance_name,
        alias,
        phone_number: phone_number || '',
        descripcion: descripcion ?? null,
        color,
        daily_limit,
        connected: false,
        activo: true,
      })
      .select()
      .single()

    if (error) {
      // Cleanup best-effort: si la fila no se creó, borramos la instancia que dejamos colgando.
      try {
        await deleteInstance(instance_name)
      } catch {
        // ignore
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  }

  // Legacy paths (twilio/wassenger). No son operativos pero se mantienen
  // para no romper datos viejos.
  if (!phone_number) {
    return NextResponse.json(
      { error: 'phone_number requerido para providers legacy' },
      { status: 400 }
    )
  }
  const { data, error } = await supabase
    .from('senders')
    .insert({ alias, provider, phone_number, descripcion, color })
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

  // Whitelist de campos editables
  const ALLOWED = new Set([
    'alias',
    'descripcion',
    'color',
    'activo',
    'daily_limit',
    'phone_number',
  ])
  const safe: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(updates)) {
    if (ALLOWED.has(k)) safe[k] = v
  }
  if (Object.keys(safe).length === 0) {
    return NextResponse.json({ error: 'sin campos válidos para actualizar' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('senders')
    .update(safe)
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
  const hard = searchParams.get('hard') === 'true'
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })

  if (!hard) {
    // Soft delete: marca activo=false. Preserva FK con conversaciones/leads.
    const { error } = await supabase.from('senders').update({ activo: false }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, mode: 'soft' })
  }

  // Hard delete: solo si no hay conversaciones referenciando este sender.
  const { count: convCount, error: convErr } = await supabase
    .from('conversaciones')
    .select('id', { count: 'exact', head: true })
    .eq('sender_id', id)
  if (convErr) return NextResponse.json({ error: convErr.message }, { status: 500 })
  if ((convCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error: `el sender tiene ${convCount} conversaciones asociadas. Usá soft delete (?hard=false o sin param).`,
      },
      { status: 409 }
    )
  }

  // También chequear leads referenciados (FK leads.sender_id)
  const { count: leadsCount } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('sender_id', id)
  if ((leadsCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error: `el sender tiene ${leadsCount} leads asociados. Usá soft delete.`,
      },
      { status: 409 }
    )
  }

  const { data: sender } = await supabase
    .from('senders')
    .select('instance_name, provider')
    .eq('id', id)
    .maybeSingle()

  if (sender?.provider === 'evolution' && sender.instance_name) {
    try {
      await deleteInstance(sender.instance_name)
    } catch (err) {
      console.warn('[DELETE hard] deleteInstance fallo (continuamos):', err)
    }
  }

  const { error } = await supabase.from('senders').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, mode: 'hard' })
}
