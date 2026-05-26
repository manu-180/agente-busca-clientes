-- apex-leads/supabase-migration-projects-multi.sql
-- Multi-proyecto: introduce tabla projects + columna project_id en leads y renombre apex_info -> project_info.
-- Spec: docs/superpowers/specs/2026-05-26-multi-proyecto-design.md
-- Plan: docs/superpowers/plans/2026-05-26-multi-proyecto.md

BEGIN;

-- 1. Tabla projects
CREATE TABLE IF NOT EXISTS public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  nombre text NOT NULL,
  descripcion text NOT NULL DEFAULT '',
  url_publica text,
  filtro_sin_web boolean NOT NULL DEFAULT false,
  rubros_sugeridos text[] NOT NULL DEFAULT '{}',
  plantilla_primer_mensaje text NOT NULL DEFAULT '',
  activo boolean NOT NULL DEFAULT true,
  orden int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed: los 4 proyectos. APEX hereda config existente; resto vacio para que Manuel complete.
INSERT INTO public.projects (slug, nombre, descripcion, url_publica, filtro_sin_web, orden) VALUES
  ('apex',      'APEX',      'Agencia de desarrollo web y apps en Buenos Aires. Llevamos años trabajando con clientes y construimos sitios y apps a medida.', 'www.theapexweb.com', true,  10),
  ('assistify', 'Assistify', '', NULL, false, 20),
  ('handy',     'Handy',     '', NULL, false, 30),
  ('botlode',   'botlode',   '', NULL, false, 40)
ON CONFLICT (slug) DO NOTHING;

-- 2-4. leads.project_id (nullable -> backfill APEX -> NOT NULL)
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id);
UPDATE public.leads
   SET project_id = (SELECT id FROM public.projects WHERE slug = 'apex')
 WHERE project_id IS NULL;
ALTER TABLE public.leads ALTER COLUMN project_id SET NOT NULL;

-- 5-8. apex_info -> project_info
ALTER TABLE public.apex_info RENAME TO project_info;
ALTER TABLE public.project_info ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id);
UPDATE public.project_info
   SET project_id = (SELECT id FROM public.projects WHERE slug = 'apex')
 WHERE project_id IS NULL;
ALTER TABLE public.project_info ALTER COLUMN project_id SET NOT NULL;

-- 9. Renombrar RLS policy de apex_info -> project_info para mantener consistencia
ALTER POLICY "service_role_all_apex_info" ON public.project_info RENAME TO "service_role_all_project_info";

-- 10. Indices
CREATE INDEX IF NOT EXISTS leads_project_id_idx ON public.leads(project_id);
CREATE INDEX IF NOT EXISTS project_info_project_id_idx ON public.project_info(project_id);
CREATE INDEX IF NOT EXISTS project_info_project_active_idx ON public.project_info(project_id) WHERE activo = true;

COMMIT;
