import { notFound } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase-server'
import { cargarProyectoPorSlug } from '@/lib/projects'
import { ProyectoClient } from './ProyectoClient'

export const dynamic = 'force-dynamic'

export default async function ProyectoPage({ params }: { params: { slug: string } }) {
  const supabase = createSupabaseServer()
  const project = await cargarProyectoPorSlug(supabase, params.slug)
  if (!project) notFound()

  const { data: infos } = await supabase
    .from('project_info')
    .select('*')
    .eq('project_id', project.id)
    .order('categoria', { ascending: true })

  return <ProyectoClient project={project} infosInicial={infos ?? []} />
}
