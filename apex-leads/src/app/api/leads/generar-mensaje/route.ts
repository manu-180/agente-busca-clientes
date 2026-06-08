import { NextRequest, NextResponse } from 'next/server'
import { generarPrimerMensaje } from '@/lib/generar-primer-mensaje'
import { createSupabaseServer } from '@/lib/supabase-server'
import { cargarProyectoApexDefault, cargarProyectoPorId } from '@/lib/projects'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { nombre, rubro, zona, descripcion, instagram, project_id } = body
    // URL de la página personalizada del negocio (Carta — `public.leads.pagina_url`).
    // Si el caller la manda, la preferimos sobre la demo genérica por rubro.
    // Toleramos ambas formas: `paginaUrl` (camelCase) y `pagina_url` (columna cruda).
    const paginaUrl: string | null = body.paginaUrl ?? body.pagina_url ?? null

    const supabase = createSupabaseServer()
    const project = project_id
      ? await cargarProyectoPorId(supabase, project_id)
      : await cargarProyectoApexDefault(supabase)

    if (!project) {
      return NextResponse.json({ error: 'No se encontró el proyecto' }, { status: 404 })
    }

    const mensaje = await generarPrimerMensaje(
      { nombre, rubro, zona, descripcion, instagram, paginaUrl },
      project,
    )

    if (!mensaje) {
      return NextResponse.json(
        { error: `No se pudo generar el mensaje. ${project.slug !== 'apex' && !(project.plantilla_primer_mensaje ?? '').trim() ? 'El proyecto no tiene plantilla configurada.' : ''}` },
        { status: 500 },
      )
    }

    return NextResponse.json({ mensaje })
  } catch {
    return NextResponse.json({ error: 'No se pudo generar el mensaje.' }, { status: 500 })
  }
}
