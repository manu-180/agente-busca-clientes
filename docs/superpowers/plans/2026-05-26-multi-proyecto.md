# Multi-proyecto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introducir el concepto de "proyecto" (APEX, Assistify, Handy, botlode) como dimensión transversal del sistema, de modo que cada lead esté atado a un proyecto y el bot use info, búsqueda y prompts scopeados al proyecto del lead — sin mezclar contexto entre productos.

**Architecture:** Tabla nueva `projects` + columna `project_id` NOT NULL en `leads` y en `project_info` (renombrada desde `apex_info`). Migración SQL transaccional con seed de los 4 proyectos. Panel `/proyectos/[slug]` para editar cada uno. Selector en `/leads/nuevo`. `agente.ts`, `prompts.ts`, `generar-primer-mensaje.ts`, `generar-followup.ts` y `google-places/search.ts` reciben el proyecto del lead y filtran por `project_id`.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Supabase (Postgres + RLS), Claude API, Tailwind, lucide-react.

**Spec:** [docs/superpowers/specs/2026-05-26-multi-proyecto-design.md](../specs/2026-05-26-multi-proyecto-design.md)

---

## File Structure (mapeo previo)

**Crear:**
- `apex-leads/supabase-migration-projects-multi.sql` — migración transaccional
- `apex-leads/src/lib/projects.ts` — helpers: `cargarProyectoPorId`, `cargarProyectoPorSlug`, `cargarProyectoPorLeadId`
- `apex-leads/src/app/api/projects/route.ts` — GET (list)
- `apex-leads/src/app/api/projects/[slug]/route.ts` — GET / PATCH (single)
- `apex-leads/src/app/proyectos/[slug]/page.tsx` — panel de proyecto (4 secciones)
- `apex-leads/src/app/proyectos/[slug]/ProyectoClient.tsx` — client component

**Modificar:**
- `apex-leads/src/types/supabase.ts` — regenerado
- `apex-leads/src/lib/verticales.ts` — rename `sanitizarApexInfoPorVertical` → `sanitizarProjectInfoPorVertical`
- `apex-leads/src/lib/agente.ts` — carga `project` del lead, filtra `project_info`
- `apex-leads/src/lib/prompts.ts` — `buildAgentPrompt` recibe `project`, identidad dinámica
- `apex-leads/src/lib/generar-primer-mensaje.ts` — usa `plantilla_primer_mensaje` del proyecto
- `apex-leads/src/lib/generar-followup.ts` — identidad del proyecto
- `apex-leads/src/lib/google-places/search.ts` — `searchPlaces(rubro, zona, { filtroSinWeb }, signal)`
- `apex-leads/src/app/api/agente/info/route.ts` — accept/return `project_id`
- `apex-leads/src/app/api/agente/sugerir/route.ts` — usar `project_info` con `project_id`
- `apex-leads/src/app/api/leads/route.ts:46` — POST insert con `project_id`
- `apex-leads/src/app/api/leads/buscar/route.ts` — recibe `project_id`, carga `filtro_sin_web`
- `apex-leads/src/app/api/leads/bulk-queue/route.ts` — persist `project_id`
- `apex-leads/src/app/api/webhook/evolution/route.ts:1051-1066` — insert con `project_id` APEX default; cambio en línea ~650 que carga `apex_info`
- `apex-leads/src/app/leads/nuevo/NuevoLeadClient.tsx` — selector + chips
- `apex-leads/src/components/layout/sidebar.tsx` — quitar "Agente IA", agregar "Proyectos" con dropdown
- `apex-leads/src/app/configuracion/page.tsx` — sumar toggle `agente_activo`

**Borrar (al final):**
- `apex-leads/src/app/agente/page.tsx` — reemplazado por `/proyectos/[slug]`

**Total: ~20 archivos tocados, 7 nuevos.**

---

## Fase 1 — Base de datos y types

### Task 1: Migración SQL transaccional

**Files:**
- Create: `apex-leads/supabase-migration-projects-multi.sql`

- [ ] **Step 1: Crear archivo de migración con BEGIN/COMMIT**

```sql
-- apex-leads/supabase-migration-projects-multi.sql
-- Multi-proyecto: introduce tabla projects + columna project_id en leads y renombre apex_info → project_info.

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

-- Seed: los 4 proyectos. APEX hereda config existente; resto vacío para que Manuel complete.
INSERT INTO public.projects (slug, nombre, descripcion, url_publica, filtro_sin_web, orden) VALUES
  ('apex',      'APEX',      'Agencia de desarrollo web y apps en Buenos Aires. Llevamos años trabajando con clientes y construimos sitios y apps a medida.', 'www.theapexweb.com', true,  10),
  ('assistify', 'Assistify', '', NULL, false, 20),
  ('handy',     'Handy',     '', NULL, false, 30),
  ('botlode',   'botlode',   '', NULL, false, 40)
ON CONFLICT (slug) DO NOTHING;

-- 2-4. leads.project_id (nullable → backfill APEX → NOT NULL)
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id);
UPDATE public.leads
   SET project_id = (SELECT id FROM public.projects WHERE slug = 'apex')
 WHERE project_id IS NULL;
ALTER TABLE public.leads ALTER COLUMN project_id SET NOT NULL;

-- 5-8. apex_info → project_info
ALTER TABLE public.apex_info RENAME TO project_info;
ALTER TABLE public.project_info ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id);
UPDATE public.project_info
   SET project_id = (SELECT id FROM public.projects WHERE slug = 'apex')
 WHERE project_id IS NULL;
ALTER TABLE public.project_info ALTER COLUMN project_id SET NOT NULL;

-- 9. Renombrar RLS policy de apex_info → project_info para mantener consistencia
ALTER POLICY "service_role_all_apex_info" ON public.project_info RENAME TO "service_role_all_project_info";

-- 10. Índices
CREATE INDEX IF NOT EXISTS leads_project_id_idx ON public.leads(project_id);
CREATE INDEX IF NOT EXISTS project_info_project_id_idx ON public.project_info(project_id);
CREATE INDEX IF NOT EXISTS project_info_project_active_idx ON public.project_info(project_id) WHERE activo = true;

COMMIT;
```

- [ ] **Step 2: Validar SQL sintácticamente con psql en dry-run (sin ejecutar)**

Comando manual (no aplicar):
```bash
psql -d postgres -f apex-leads/supabase-migration-projects-multi.sql --dry-run 2>&1 | head -20
```
*(El dry-run real lo hacemos en Task 2 vía MCP de Supabase contra una branch.)*

- [ ] **Step 3: Commit**

```bash
git add apex-leads/supabase-migration-projects-multi.sql
git commit -m "feat(db): migración SQL transaccional para multi-proyecto"
```

### Task 2: Aplicar migración en Supabase

**Files:**
- Modify: ninguno (operación sobre DB)

- [ ] **Step 1: Verificar tablas actuales antes de aplicar**

Usar MCP `mcp__supabase-conductor__list_tables` para confirmar que `apex_info` y `leads` existen y no hay tabla `projects` previa.

- [ ] **Step 2: Aplicar migración vía MCP**

Usar `mcp__supabase-conductor__apply_migration` con el contenido del archivo `supabase-migration-projects-multi.sql` y nombre `projects_multi`.

- [ ] **Step 3: Verificar resultado**

Usar `mcp__supabase-conductor__execute_sql`:
```sql
SELECT slug, nombre, filtro_sin_web FROM public.projects ORDER BY orden;
SELECT COUNT(*) AS leads_total, COUNT(project_id) AS leads_con_proyecto FROM public.leads;
SELECT COUNT(*) AS info_total, COUNT(project_id) AS info_con_proyecto FROM public.project_info;
```

Expected:
- 4 filas en projects (apex, assistify, handy, botlode)
- `leads_total == leads_con_proyecto` (todos los leads viejos quedaron en APEX)
- `info_total == info_con_proyecto`

- [ ] **Step 4: Si Step 3 muestra mismatch, ROLLBACK**

Si algo no cuadra, ejecutar:
```sql
BEGIN;
ALTER TABLE public.project_info DROP COLUMN project_id;
ALTER TABLE public.project_info RENAME TO apex_info;
ALTER POLICY "service_role_all_project_info" ON public.apex_info RENAME TO "service_role_all_apex_info";
ALTER TABLE public.leads DROP COLUMN project_id;
DROP TABLE public.projects;
COMMIT;
```

Y reportar al usuario.

### Task 3: Regenerar types TypeScript

**Files:**
- Modify: `apex-leads/src/types/supabase.ts`

- [ ] **Step 1: Regenerar con MCP**

Usar `mcp__supabase-conductor__generate_typescript_types` y sobrescribir `src/types/supabase.ts`.

- [ ] **Step 2: Verificar que aparece `projects` y `project_info`**

```bash
grep -E "projects:|project_info:" apex-leads/src/types/supabase.ts
```
Expected: 2 matches (uno por cada tabla, sección `Tables`).

- [ ] **Step 3: Verificar que NO aparece `apex_info`**

```bash
grep "apex_info:" apex-leads/src/types/supabase.ts
```
Expected: 0 matches.

- [ ] **Step 4: Commit**

```bash
git add apex-leads/src/types/supabase.ts
git commit -m "feat(types): regenerar tipos tras migración multi-proyecto"
```

---

## Fase 2 — Lib backend

### Task 4: Renombrar sanitizarApexInfoPorVertical

**Files:**
- Modify: `apex-leads/src/lib/verticales.ts`
- Modify: `apex-leads/src/lib/agente.ts`

- [ ] **Step 1: En `verticales.ts`, renombrar export**

Cambio en `apex-leads/src/lib/verticales.ts` línea 265:
```ts
export function sanitizarProjectInfoPorVertical(
  projectInfo: string,
  verticalLead: VerticalId
): { texto: string; removidas: VerticalId[] } {
  if (!projectInfo || verticalLead === 'generico') {
    return { texto: projectInfo ?? '', removidas: [] }
  }
  // ... (resto idéntico, solo cambia el nombre del parámetro)
```

- [ ] **Step 2: Actualizar import en `agente.ts`**

En `apex-leads/src/lib/agente.ts` línea 27:
```ts
import { detectarVertical, sanitizarProjectInfoPorVertical } from '@/lib/verticales'
```

Y en la línea ~99 donde se llama:
```ts
const projectInfoSanitizado = sanitizarProjectInfoPorVertical(projectInfoTextoRaw, verticalLead)
```

(Renombrar también `apexInfoTextoRaw` → `projectInfoTextoRaw`, `apexInfoSanitizado` → `projectInfoSanitizado`, `apexInfoTexto` → `projectInfoTexto`.)

- [ ] **Step 3: Build pasa**

```bash
cd apex-leads && npm run build 2>&1 | tail -20
```
Expected: build exitoso (no errores de tipo).

- [ ] **Step 4: Commit**

```bash
git add apex-leads/src/lib/verticales.ts apex-leads/src/lib/agente.ts
git commit -m "refactor(lib): rename sanitizarApexInfoPorVertical → sanitizarProjectInfoPorVertical"
```

### Task 5: Crear lib/projects.ts (helpers)

**Files:**
- Create: `apex-leads/src/lib/projects.ts`

- [ ] **Step 1: Crear archivo con helpers tipados**

```ts
// apex-leads/src/lib/projects.ts
import type { Database } from '@/types/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

export type ProjectRow = Database['public']['Tables']['projects']['Row']

/** Slug del proyecto por defecto cuando no se especifica (legacy + leads inbound desconocidos). */
export const DEFAULT_PROJECT_SLUG = 'apex'

export async function cargarProyectoPorId(
  supabase: SupabaseClient<Database>,
  projectId: string
): Promise<ProjectRow | null> {
  const { data } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single()
  return data
}

export async function cargarProyectoPorSlug(
  supabase: SupabaseClient<Database>,
  slug: string
): Promise<ProjectRow | null> {
  const { data } = await supabase
    .from('projects')
    .select('*')
    .eq('slug', slug)
    .single()
  return data
}

export async function cargarProyectoApexDefault(
  supabase: SupabaseClient<Database>
): Promise<ProjectRow | null> {
  return cargarProyectoPorSlug(supabase, DEFAULT_PROJECT_SLUG)
}

export async function listarProyectosActivos(
  supabase: SupabaseClient<Database>
): Promise<ProjectRow[]> {
  const { data } = await supabase
    .from('projects')
    .select('*')
    .eq('activo', true)
    .order('orden', { ascending: true })
  return data ?? []
}
```

- [ ] **Step 2: Build pasa**

```bash
cd apex-leads && npm run build 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add apex-leads/src/lib/projects.ts
git commit -m "feat(lib): helpers para cargar proyectos (cargarProyectoPorId/Slug)"
```

### Task 6: agente.ts carga proyecto del lead

**Files:**
- Modify: `apex-leads/src/lib/agente.ts`

- [ ] **Step 1: Importar helpers de proyecto**

Agregar al tope:
```ts
import { cargarProyectoPorId, type ProjectRow } from '@/lib/projects'
```

- [ ] **Step 2: Después de cargar lead, cargar proyecto**

Después del bloque que carga `lead` (línea ~63) y antes del bloque que carga info (línea ~84):

```ts
// 3.5 Cargar el proyecto al que pertenece el lead
const project = await cargarProyectoPorId(supabase, lead.project_id)
if (!project) {
  console.error('[AGENTE] No se encontró el proyecto del lead:', lead.project_id)
  return { respuesta: null }
}
```

- [ ] **Step 3: Cambiar query de info por project_id**

Reemplazar el bloque `from('apex_info').select(...)` (que después del refactor está como `from('project_info')`):

```ts
const { data: projectInfo } = await supabase
  .from('project_info')
  .select('categoria, titulo, contenido')
  .eq('project_id', lead.project_id)
  .eq('activo', true)
```

- [ ] **Step 4: Pasar el proyecto a buildAgentPrompt**

En la llamada a `buildAgentPrompt`, agregar `project` como argumento. (La signature de `buildAgentPrompt` se actualiza en Task 7.)

- [ ] **Step 5: Build pasa**

```bash
cd apex-leads && npm run build 2>&1 | tail -10
```

Nota: este task puede dejar el build roto temporalmente hasta Task 7. Es OK; commiteamos juntos.

- [ ] **Step 6: Commit (junto con Task 7)**

(El commit va al final de Task 7 para que el build quede verde.)

### Task 7: prompts.ts buildAgentPrompt recibe project

**Files:**
- Modify: `apex-leads/src/lib/prompts.ts`

- [ ] **Step 1: Importar tipo ProjectRow**

```ts
import type { ProjectRow } from '@/lib/projects'
```

- [ ] **Step 2: Convertir SYSTEM_PROMPT_BASE a función**

Reemplazar la constante `SYSTEM_PROMPT_BASE` (que arranca con `"Sos Manuel, parte del equipo de APEX..."`) por una función que recibe el proyecto:

```ts
export function buildSystemPromptBase(project: ProjectRow): string {
  const identidad = `Sos Manuel, parte del equipo de ${project.nombre}.${project.descripcion ? ' ' + project.descripcion : ''}`

  // Mantener las partes del prompt que son agnósticas (pre_response_checklist, hard_rules, voice, format, etc.)
  // pero el texto "agencia de desarrollo web y apps en Buenos Aires" desaparece — lo trae project.descripcion.

  return `${identidad} Llevás tres años trabajando con clientes y tu laburo en WhatsApp es atender consultas y cerrar proyectos. Hablás como una persona real del equipo y no mencionás sistemas automatizados, bots ni asistentes virtuales bajo ningún concepto.

${PRE_RESPONSE_CHECKLIST}
${HARD_RULES}
${CONTINUITY_RULES}
${VOICE}
${FORMAT}
${OBJECTION_HANDLING_GENERAL}
${CLOSING_SIGNALS}
${EXAMPLES_GENERAL}
${project.slug === 'apex' ? APEX_SPECIFIC_EXAMPLES : ''}
${BAD_EXAMPLES}`
}
```

Donde `PRE_RESPONSE_CHECKLIST`, `HARD_RULES`, etc. son `const string` con cada bloque del prompt actual. Los ejemplos específicos de APEX ("boceto", "ya tengo web", "WhatsApp.com.ar") van a `APEX_SPECIFIC_EXAMPLES`. Los demás ejemplos quedan en `EXAMPLES_GENERAL`.

- [ ] **Step 3: SYSTEM_PROMPT_OUTBOUND / INBOUND también pasan a funciones**

```ts
export function buildSystemPromptOutbound(project: ProjectRow): string {
  return `${buildSystemPromptBase(project)}\n\n${OUTBOUND_EXTRAS}`
}

export function buildSystemPromptInbound(project: ProjectRow): string {
  return `${buildSystemPromptBase(project)}\n\n${INBOUND_EXTRAS}`
}
```

- [ ] **Step 4: buildAgentPrompt recibe project**

```ts
export function buildAgentPrompt(
  origen: 'outbound' | 'inbound',
  project: ProjectRow,
  projectInfo: string,
  historial: string,
  contextoLead: AgenteContextoLead
): string {
  const basePrompt = origen === 'outbound'
    ? buildSystemPromptOutbound(project)
    : buildSystemPromptInbound(project)
  // ... resto idéntico, solo se pasa el project al base
}
```

- [ ] **Step 5: Actualizar call site en agente.ts**

En `agente.ts`, ajustar la llamada para incluir `project`:
```ts
const systemPrompt = buildAgentPrompt(origen, project, projectInfoTexto, '', contextoLead)
```

- [ ] **Step 6: Build pasa**

```bash
cd apex-leads && npm run build 2>&1 | tail -10
```

- [ ] **Step 7: Commit**

```bash
git add apex-leads/src/lib/agente.ts apex-leads/src/lib/prompts.ts
git commit -m "feat(agente): prompts dinámicos por proyecto (identidad + ejemplos APEX condicionados a slug)"
```

### Task 8: generar-primer-mensaje recibe project

**Files:**
- Modify: `apex-leads/src/lib/generar-primer-mensaje.ts`

- [ ] **Step 1: Leer archivo actual**

Inspeccionar la signature actual de `generarPrimerMensaje` y dónde se llama.

- [ ] **Step 2: Agregar parámetro project a la signature**

La función recibe ahora `project: ProjectRow` además del lead. La instrucción base para Claude pasa de hardcodear APEX a usar `project.plantilla_primer_mensaje` + `project.descripcion`.

Si `project.plantilla_primer_mensaje` está vacío (caso Assistify/Handy/botlode pre-configuración), la función retorna `{ mensaje: null, motivo: 'plantilla_vacia' }` y el cron debe saltar ese lead.

- [ ] **Step 3: Actualizar todos los call sites**

`grep -rn "generarPrimerMensaje" apex-leads/src/` y ajustar cada uno para cargar el proyecto del lead antes de invocar.

- [ ] **Step 4: Build pasa**

```bash
cd apex-leads && npm run build 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add apex-leads/src/lib/generar-primer-mensaje.ts apex-leads/src/app/api/cron/leads-pendientes/
git commit -m "feat(outbound): primer mensaje usa plantilla del proyecto del lead"
```

### Task 9: generar-followup recibe project

**Files:**
- Modify: `apex-leads/src/lib/generar-followup.ts`
- Modify: `apex-leads/src/app/api/cron/followup/route.ts` (call site)

- [ ] **Step 1: Misma mecánica que Task 8** — la función recibe `project` y usa `project.nombre`/`project.descripcion` para la identidad en lugar del hardcodeo de APEX.

- [ ] **Step 2: Build + commit**

```bash
cd apex-leads && npm run build 2>&1 | tail -10
git add apex-leads/src/lib/generar-followup.ts apex-leads/src/app/api/cron/followup/
git commit -m "feat(followup): followup usa identidad del proyecto del lead"
```

### Task 10: google-places/search.ts parametriza filtro_sin_web

**Files:**
- Modify: `apex-leads/src/lib/google-places/search.ts`

- [ ] **Step 1: Cambiar signature de searchPlaces**

```ts
export interface SearchPlacesOptions {
  filtroSinWeb: boolean
}

export async function searchPlaces(
  rubro: string,
  zona: string,
  options: SearchPlacesOptions,
  signal?: AbortSignal,
): Promise<PlacesSearchOk> {
  // ...
}
```

- [ ] **Step 2: Pasar options a parseResultados**

```ts
function parseResultados(rubro: string, bodyText: string, options: SearchPlacesOptions): ResultadoBusquedaLead[] {
  // ...
  for (const place of places) {
    // ...
    const tieneWeb = Boolean(urlWeb)
    if (options.filtroSinWeb && tieneWeb) continue  // ← cambio acá

    // resto idéntico
  }
}
```

- [ ] **Step 3: Build pasa**

```bash
cd apex-leads && npm run build 2>&1 | tail -10
```

Expected: errores en el caller (`/api/leads/buscar/route.ts`) — se arreglan en Task 12.

- [ ] **Step 4: Commit (con Task 12)**

---

## Fase 3 — API endpoints

### Task 11: /api/agente/info acepta/devuelve project_id

**Files:**
- Modify: `apex-leads/src/app/api/agente/info/route.ts`

- [ ] **Step 1: GET filtra por project_id desde query string**

```ts
export async function GET(req: NextRequest) {
  const supabase = createSupabaseServer()
  const projectId = req.nextUrl.searchParams.get('project_id')
  if (!projectId) {
    return NextResponse.json({ error: 'Falta project_id' }, { status: 400 })
  }
  const { data, error } = await supabase
    .from('project_info')
    .select('*')
    .eq('project_id', projectId)
    .order('categoria', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ infos: data })
}
```

- [ ] **Step 2: POST recibe project_id en el body**

```ts
const { data, error } = await supabase
  .from('project_info')
  .insert({
    project_id: body.project_id,
    categoria: body.categoria,
    titulo: body.titulo,
    contenido: body.contenido,
  })
  .select()
  .single()
```

- [ ] **Step 3: PUT, DELETE: cambiar `apex_info` → `project_info`** (no necesitan project_id porque ya tienen el `id` del row)

- [ ] **Step 4: Build pasa**

```bash
cd apex-leads && npm run build 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add apex-leads/src/app/api/agente/info/route.ts
git commit -m "feat(api): /api/agente/info scopeado por project_id"
```

### Task 12: /api/leads/buscar carga proyecto, aplica filtro_sin_web

**Files:**
- Modify: `apex-leads/src/app/api/leads/buscar/route.ts`

- [ ] **Step 1: Recibe project_id en el body y carga el proyecto**

```ts
const { rubro, zona, project_id } = await req.json()
if (!project_id) {
  return NextResponse.json({ error: 'Falta project_id' }, { status: 400 })
}

const project = await cargarProyectoPorId(supabase, project_id)
if (!project) {
  return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 })
}

const result = await searchPlaces(rubro, zona, { filtroSinWeb: project.filtro_sin_web })
// ... resto idéntico
```

- [ ] **Step 2: Build pasa**

```bash
cd apex-leads && npm run build 2>&1 | tail -10
```

- [ ] **Step 3: Commit (incluye Task 10)**

```bash
git add apex-leads/src/lib/google-places/search.ts apex-leads/src/app/api/leads/buscar/route.ts
git commit -m "feat(search): filtro_sin_web se decide por proyecto (no hardcoded)"
```

### Task 13: /api/leads/bulk-queue persist project_id

**Files:**
- Modify: `apex-leads/src/app/api/leads/bulk-queue/route.ts`

- [ ] **Step 1: Recibe project_id en el body, persiste en cada insert**

```ts
const { leads, project_id } = await req.json()
if (!project_id) {
  return NextResponse.json({ error: 'Falta project_id' }, { status: 400 })
}

// En cada insert:
.insert({
  project_id,
  nombre: l.nombre,
  rubro: l.rubro,
  // ... resto
})
```

- [ ] **Step 2: Build + commit**

```bash
cd apex-leads && npm run build 2>&1 | tail -10
git add apex-leads/src/app/api/leads/bulk-queue/route.ts
git commit -m "feat(api): bulk-queue persiste project_id en cada lead"
```

### Task 14: /api/leads POST acepta project_id con fallback APEX

**Files:**
- Modify: `apex-leads/src/app/api/leads/route.ts`

- [ ] **Step 1: Importar helper de proyecto APEX**

```ts
import { cargarProyectoApexDefault } from '@/lib/projects'
```

- [ ] **Step 2: En POST, leer project_id del body o caer a APEX**

```ts
let projectId: string | null = typeof body.project_id === 'string' ? body.project_id : null
if (!projectId) {
  const apex = await cargarProyectoApexDefault(supabase)
  projectId = apex?.id ?? null
}
if (!projectId) {
  return NextResponse.json({ error: 'No se pudo determinar el proyecto' }, { status: 500 })
}
```

- [ ] **Step 3: Pasar project_id en el insert (línea 46)**

```ts
.insert({
  project_id: projectId,
  nombre: body.nombre,
  rubro: body.rubro,
  // ... resto
})
```

- [ ] **Step 4: Build + commit**

```bash
cd apex-leads && npm run build 2>&1 | tail -10
git add apex-leads/src/app/api/leads/route.ts
git commit -m "feat(api): POST /api/leads acepta project_id (fallback APEX por compat)"
```

### Task 15: Webhook crea leads con project_id APEX por default

**Files:**
- Modify: `apex-leads/src/app/api/webhook/evolution/route.ts`

- [ ] **Step 1: Cargar APEX una sola vez al inicio del handler que crea leads**

Antes del bloque `if (!lead)` en línea ~1048, cargar el proyecto APEX:
```ts
const apexProject = await cargarProyectoApexDefault(supabase)
if (!apexProject) {
  console.error('[Evolution] No se pudo cargar el proyecto APEX por default')
  return
}
```

- [ ] **Step 2: Sumar project_id al insert (línea 1053-1066)**

```ts
.insert({
  project_id: apexProject.id,
  nombre: `Lead ${telefono.slice(-4)}`,
  rubro: 'Por definir',
  // ... resto
})
```

- [ ] **Step 3: También cambiar la query de info en línea ~650**

Ese código carga `apex_info` para algo (probablemente para el bot). Ya se va a corregir cuando hagamos pasar por `agente.ts`, pero verifico si hay otro consumo directo y lo arreglo.

```ts
// Si la línea ~650 era:
//   supabase.from('apex_info').select(...)
// pasa a usar el project_id del lead:
//   supabase.from('project_info').select(...).eq('project_id', lead.project_id)
```

- [ ] **Step 4: Build + commit**

```bash
cd apex-leads && npm run build 2>&1 | tail -10
git add apex-leads/src/app/api/webhook/evolution/route.ts
git commit -m "feat(webhook): leads inbound desconocidos se asignan a APEX por default"
```

### Task 16: /api/agente/sugerir actualizado

**Files:**
- Modify: `apex-leads/src/app/api/agente/sugerir/route.ts`

- [ ] **Step 1: Cambiar `from('apex_info')` → `from('project_info')` con filtro por project_id del lead**

Probablemente este endpoint recibe un lead_id o telefono — habría que cargar el lead, leer su `project_id`, y filtrar por ese.

- [ ] **Step 2: Build + commit**

```bash
cd apex-leads && npm run build 2>&1 | tail -10
git add apex-leads/src/app/api/agente/sugerir/route.ts
git commit -m "feat(api): sugerir filtra project_info por proyecto del lead"
```

### Task 17: Nuevo endpoint /api/projects

**Files:**
- Create: `apex-leads/src/app/api/projects/route.ts`
- Create: `apex-leads/src/app/api/projects/[slug]/route.ts`

- [ ] **Step 1: GET /api/projects (lista los 4)**

```ts
// apex-leads/src/app/api/projects/route.ts
import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { listarProyectosActivos } from '@/lib/projects'

export async function GET() {
  const supabase = createSupabaseServer()
  const projects = await listarProyectosActivos(supabase)
  return NextResponse.json({ projects })
}
```

- [ ] **Step 2: GET / PATCH /api/projects/[slug]**

```ts
// apex-leads/src/app/api/projects/[slug]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { cargarProyectoPorSlug } from '@/lib/projects'

const ALLOWED_FIELDS = new Set([
  'nombre', 'descripcion', 'url_publica',
  'filtro_sin_web', 'rubros_sugeridos', 'plantilla_primer_mensaje',
])

export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  const supabase = createSupabaseServer()
  const project = await cargarProyectoPorSlug(supabase, params.slug)
  if (!project) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  return NextResponse.json({ project })
}

export async function PATCH(req: NextRequest, { params }: { params: { slug: string } }) {
  const supabase = createSupabaseServer()
  const body = await req.json()
  const safe: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED_FIELDS.has(k)) safe[k] = v
  }
  safe.updated_at = new Date().toISOString()
  const { data, error } = await supabase
    .from('projects')
    .update(safe)
    .eq('slug', params.slug)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ project: data })
}
```

- [ ] **Step 3: Build + commit**

```bash
cd apex-leads && npm run build 2>&1 | tail -10
git add apex-leads/src/app/api/projects/
git commit -m "feat(api): GET /api/projects + GET/PATCH /api/projects/[slug]"
```

---

## Fase 4 — UI: Panel de proyecto

### Task 18: Página /proyectos/[slug] con 4 secciones

**Files:**
- Create: `apex-leads/src/app/proyectos/[slug]/page.tsx`
- Create: `apex-leads/src/app/proyectos/[slug]/ProyectoClient.tsx`

- [ ] **Step 1: Server component que carga datos**

```tsx
// apex-leads/src/app/proyectos/[slug]/page.tsx
import { notFound } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase-server'
import { cargarProyectoPorSlug } from '@/lib/projects'
import { ProyectoClient } from './ProyectoClient'

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
```

- [ ] **Step 2: Client component con las 4 secciones (Identidad, Búsqueda, Plantilla, Info)**

Crear `ProyectoClient.tsx` con:
- Identidad: inputs (nombre, descripción, url_publica) → PATCH `/api/projects/[slug]`
- Búsqueda: toggle (filtro_sin_web), lista editable de chips (rubros_sugeridos) → PATCH
- Plantilla: textarea grande (plantilla_primer_mensaje) → PATCH
- Info: replica la UI de `/agente/page.tsx` (form add/edit + cards) pero apuntando a `/api/agente/info?project_id=...`

El componente debe seguir el sistema de diseño actual (bg-apex-card, border-apex-border, font-syne, etc.) tomando como referencia [src/app/agente/page.tsx](apex-leads/src/app/agente/page.tsx) y [src/app/configuracion/page.tsx](apex-leads/src/app/configuracion/page.tsx).

- [ ] **Step 3: Verificar visualmente con `npm run dev`**

```bash
cd apex-leads && npm run dev
```
Abrir http://localhost:3000/proyectos/apex y http://localhost:3000/proyectos/assistify, verificar que se ven bien las 4 secciones.

- [ ] **Step 4: Commit**

```bash
git add apex-leads/src/app/proyectos/
git commit -m "feat(ui): página /proyectos/[slug] con identidad, búsqueda, plantilla e info"
```

### Task 19: Sidebar — reemplazar "Agente IA" por "Proyectos" con dropdown

**Files:**
- Modify: `apex-leads/src/components/layout/sidebar.tsx`

- [ ] **Step 1: Quitar item /agente y agregar item Proyectos con dropdown**

Cambiar el array `navItems` y la lógica de render para soportar items con sub-items (dropdown expandible al click). Cargar la lista de proyectos desde `/api/projects` con un fetch al montar.

```tsx
// Estructura conceptual:
// - { href: '/proyectos', label: 'Proyectos', icon: Briefcase, children: [...projects] }
// - Click en "Proyectos" toggle el dropdown
// - Children: <Link href={`/proyectos/${slug}`}>{nombre}</Link>
```

- [ ] **Step 2: Probar visualmente**

Verificar que el dropdown abre/cierra, que cada item linkea a la página correcta, y que el item "Agente IA" ya no aparece.

- [ ] **Step 3: Commit**

```bash
git add apex-leads/src/components/layout/sidebar.tsx
git commit -m "feat(sidebar): reemplazar 'Agente IA' por 'Proyectos' con dropdown de los 4"
```

---

## Fase 5 — Nuevo Lead

### Task 20: /leads/nuevo con selector de proyecto y chips de rubros

**Files:**
- Modify: `apex-leads/src/app/leads/nuevo/NuevoLeadClient.tsx`

- [ ] **Step 1: Cargar proyectos al montar**

```tsx
const [projects, setProjects] = useState<ProjectRow[]>([])
const [proyectoSeleccionado, setProyectoSeleccionado] = useState<string | null>(null)

useEffect(() => {
  fetch('/api/projects').then(r => r.json()).then(({ projects }) => {
    setProjects(projects)
    const apex = projects.find((p: ProjectRow) => p.slug === 'apex')
    setProyectoSeleccionado(apex?.id ?? projects[0]?.id ?? null)
  })
}, [])
```

- [ ] **Step 2: Renderizar selector de proyecto arriba del input de rubro**

```tsx
<select
  value={proyectoSeleccionado ?? ''}
  onChange={(e) => setProyectoSeleccionado(e.target.value)}
  className="..."
>
  {projects.map((p) => (
    <option key={p.id} value={p.id}>{p.nombre}</option>
  ))}
</select>
```

- [ ] **Step 3: Renderizar chips de rubros sugeridos del proyecto activo**

```tsx
{proyectoActual?.rubros_sugeridos.map((r) => (
  <button key={r} onClick={() => setRubro(r)} className="chip-style">
    {r}
  </button>
))}
```

- [ ] **Step 4: Indicador visual del filtro_sin_web**

```tsx
<p className="text-xs text-apex-muted">
  {proyectoActual?.filtro_sin_web
    ? '🔎 Mostrando solo negocios sin web'
    : '🌐 Mostrando todos los resultados'}
</p>
```

- [ ] **Step 5: Pasar project_id en cada fetch a /api/leads/buscar y /api/leads/bulk-queue**

En la función `buscarEnLocalidad`:
```ts
body: JSON.stringify({ rubro, zona: zonaLocal, project_id: proyectoSeleccionado }),
```

En `encolarLeads`:
```ts
body: JSON.stringify({ leads: permitidos.map(...), project_id: proyectoSeleccionado }),
```

- [ ] **Step 6: Verificar visualmente**

```bash
cd apex-leads && npm run dev
```
Abrir /leads/nuevo, verificar selector + chips + búsqueda funcionando.

- [ ] **Step 7: Commit**

```bash
git add apex-leads/src/app/leads/nuevo/NuevoLeadClient.tsx
git commit -m "feat(ui): /leads/nuevo con selector de proyecto y chips de rubros"
```

---

## Fase 6 — Limpieza y verificación

### Task 21: Mover toggle agente_activo a /configuracion + borrar /agente

**Files:**
- Modify: `apex-leads/src/app/configuracion/page.tsx`
- Delete: `apex-leads/src/app/agente/page.tsx`

- [ ] **Step 1: Sumar toggle a /configuracion**

Tomar la lógica de toggle de `/agente/page.tsx` (líneas 36-44) y meterla en `/configuracion/page.tsx` como un toggle más, junto a `decision_engine_enabled`, `emoji_no_reply_enabled`, etc.

- [ ] **Step 2: Borrar /agente/page.tsx**

```bash
rm apex-leads/src/app/agente/page.tsx
```

- [ ] **Step 3: Verificar que no haya links rotos al /agente**

```bash
grep -rn "'/agente'" apex-leads/src/ --include="*.tsx" --include="*.ts"
```
Expected: 0 matches (ya quitamos del sidebar; cualquier otro link viejo lo arreglamos).

- [ ] **Step 4: Build + verificar visualmente**

```bash
cd apex-leads && npm run dev
```
Abrir /configuracion, verificar que el toggle "Agente IA activo" funciona. Abrir /agente, verificar que devuelve 404.

- [ ] **Step 5: Commit**

```bash
git add apex-leads/src/app/configuracion/page.tsx
git rm apex-leads/src/app/agente/page.tsx
git commit -m "refactor(ui): toggle agente_activo movido a /configuracion; borrar /agente"
```

### Task 22: Auditoría final — grep apex_info en código

**Files:** ninguno (solo verificación)

- [ ] **Step 1: Grep exhaustivo**

```bash
grep -rn "apex_info" apex-leads/src/ --include="*.ts" --include="*.tsx"
```
Expected: 0 matches (todas las referencias en código fueron migradas).

```bash
grep -rn "sanitizarApexInfoPorVertical" apex-leads/src/ --include="*.ts" --include="*.tsx"
```
Expected: 0 matches.

- [ ] **Step 2: Si hay matches, arreglarlos**

Cada match es un bug residual. Arreglar y rebuilder.

- [ ] **Step 3: Build final**

```bash
cd apex-leads && npm run build
```
Expected: build exitoso sin warnings de tipo.

- [ ] **Step 4: Tests pasan**

```bash
cd apex-leads && npm test 2>&1 | tail -20
```
Expected: todos los tests pasan. Si alguno falla por referencia a `apex_info`, actualizarlo a `project_info` + project_id.

- [ ] **Step 5: Commit si hubo arreglos**

```bash
git add -A
git commit -m "fix: limpiar referencias residuales a apex_info en tests/lib"
```

### Task 23: Verificación funcional end-to-end (manual)

**Files:** ninguno (test manual)

- [ ] **Step 1: Levantar dev**

```bash
cd apex-leads && npm run dev
```

- [ ] **Step 2: Verificar sidebar muestra "Proyectos" con los 4**

Abrir http://localhost:3000/dashboard. En el sidebar: no debe aparecer "Agente IA", debe aparecer "Proyectos" con dropdown que muestra APEX, Assistify, Handy, botlode.

- [ ] **Step 3: Configurar Assistify desde su panel**

Ir a /proyectos/assistify y completar:
- Descripción: "Assistify es una app para que talleres gestionen alumnos, cobros mensuales y asistencia"
- URL pública: (opcional)
- Filtro sin web: OFF
- Rubros sugeridos: agregar 3 chips ("taller de cerámica", "clases de música", "clases de arte")
- Plantilla primer mensaje: cualquier texto de prueba
- Sumar 1 bloque de info: categoría=precios, título=Plan estándar, contenido=Plan mensual $5000 ARS por alumno

Guardar todo.

- [ ] **Step 4: Crear un lead de prueba de Assistify**

Ir a /leads/nuevo, seleccionar Assistify en el selector, escribir "taller de cerámica" en rubro, elegir una localidad chica (ej. Vicente López), ejecutar búsqueda. Verificar que:
- Los chips de rubros muestran los 3 que cargaste.
- El indicador dice "Mostrando todos los resultados" (no "solo sin web").
- Los resultados aparecen.
- Encolar (si hay resultados con teléfono).

- [ ] **Step 5: Verificar en DB que el lead quedó con project_id de Assistify**

Vía MCP:
```sql
SELECT l.nombre, l.rubro, p.slug
FROM leads l
JOIN projects p ON p.id = l.project_id
ORDER BY l.created_at DESC LIMIT 3;
```
Expected: el lead nuevo aparece con `slug = 'assistify'`.

- [ ] **Step 6: Simular respuesta entrante de ese lead (opcional / requiere Wassenger/Evolution)**

Si tenés un sender de prueba: mandar un mensaje desde el teléfono del lead simulando que respondió. Verificar en los logs del bot que la respuesta menciona Assistify (no APEX). Verificar que la respuesta no menciona "boceto" ni "web" — son palabras de APEX.

- [ ] **Step 7: Test contrario: lead viejo de APEX sigue funcionando**

Buscar un lead viejo (ya en producción, todos en APEX) y verificar que su próxima respuesta menciona APEX y mantiene las objection_handling específicas (boceto, "ya tengo web", etc.).

- [ ] **Step 8: Reportar resultado**

Si todo pasa, listo. Si algo falla, documentar y arreglar.

---

## Definition of Done (chequeo final)

- [ ] Migración aplicada y rollback testeado (Tasks 1-2)
- [ ] Types regenerados, build pasa sin errores (Task 3, Task 22)
- [ ] `grep apex_info src/` devuelve 0 matches en código (Task 22)
- [ ] RLS policy renombrada (Task 2 verificación post-migración)
- [ ] `sanitizarApexInfoPorVertical` renombrada (Task 4)
- [ ] Insert del webhook tiene `project_id` (Task 15)
- [ ] Sidebar muestra "Proyectos" con dropdown de los 4 (Task 19)
- [ ] Panel `/proyectos/[slug]` funciona para los 4 (Task 18)
- [ ] `/leads/nuevo` tiene selector + chips + indicador filtro (Task 20)
- [ ] Bot responde con info del proyecto del lead, no mezcla (Task 23 step 6-7)
- [ ] Cron de primer envío usa plantilla del proyecto (Task 8)
- [ ] Toggle agente_activo en /configuracion (Task 21)
- [ ] /agente borrado (Task 21)
- [ ] Tests existentes pasan (Task 22)
