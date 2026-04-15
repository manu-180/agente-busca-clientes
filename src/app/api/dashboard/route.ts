import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

export async function GET() {
  const supabase = createSupabaseServer()

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)

  const [totalRes, contactadosRes, respondieronRes, interesadosRes, cerradosRes, recientesRes] =
    await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true })
        .eq('estado', 'contactado').gte('updated_at', today.toISOString()),
      supabase.from('leads').select('id', { count: 'exact', head: true })
        .eq('estado', 'respondio'),
      supabase.from('leads').select('id', { count: 'exact', head: true })
        .eq('estado', 'interesado'),
      supabase.from('leads').select('id', { count: 'exact', head: true })
        .eq('estado', 'cerrado').gte('updated_at', firstOfMonth.toISOString()),
      supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(10),
    ])

  return NextResponse.json({
    total_leads: totalRes.count ?? 0,
    contactados_hoy: contactadosRes.count ?? 0,
    respondieron: respondieronRes.count ?? 0,
    interesados: interesadosRes.count ?? 0,
    cerrados_mes: cerradosRes.count ?? 0,
    leads_recientes: recientesRes.data ?? [],
  })
}
