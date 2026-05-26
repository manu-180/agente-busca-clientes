import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { listarProyectosActivos } from '@/lib/projects'

export const dynamic = 'force-dynamic'

/** GET /api/projects → lista los 4 proyectos activos ordenados por `orden`. */
export async function GET() {
  const supabase = createSupabaseServer()
  const projects = await listarProyectosActivos(supabase)
  return NextResponse.json({ projects })
}
