import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

const CLAVE = 'active_queue_project_id'

/** GET — devuelve el project_id activo para el cron (null = todos). */
export async function GET() {
  const supabase = createSupabaseServer()
  const { data } = await supabase
    .from('configuracion')
    .select('valor')
    .eq('clave', CLAVE)
    .maybeSingle()

  return NextResponse.json({ project_id: data?.valor || null })
}

/** PATCH { project_id: string | null } — cambia qué proyecto procesa el cron. */
export async function PATCH(req: Request) {
  const supabase = createSupabaseServer()
  const body = (await req.json()) as { project_id?: string | null }
  const valor = body.project_id ?? ''

  const { error } = await supabase
    .from('configuracion')
    .upsert({ clave: CLAVE, valor }, { onConflict: 'clave' })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, project_id: valor || null })
}
