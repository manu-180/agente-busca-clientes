-- apex-leads/supabase-migration-sender-project.sql
-- Agrega project_id a la tabla senders para mapear cada instancia/número
-- al proyecto correspondiente. El proyecto del sender determina el contexto
-- de respuesta del agente (qué knowledge base usa Claude), independientemente
-- del project_id histórico del lead.
--
-- Caso concreto: "Manu celu actual" → APEX.
-- Si alguien escribe al número APEX, el agente responde con info de APEX
-- aunque el lead esté registrado en otro proyecto.

ALTER TABLE public.senders
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS senders_project_id_idx ON public.senders(project_id);

COMMENT ON COLUMN public.senders.project_id IS
  'Proyecto asociado a esta instancia. Cuando está seteado, el agente usa este '
  'proyecto como contexto (knowledge base) para responder, sin importar el '
  'project_id histórico del lead.';
