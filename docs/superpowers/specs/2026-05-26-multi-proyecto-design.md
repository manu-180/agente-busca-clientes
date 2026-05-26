# Multi-proyecto: APEX + Assistify + Handy + botlode

**Fecha:** 2026-05-26
**Estado:** Spec aprobado — pendiente de plan de implementación
**Autor:** Manuel + Claude (brainstorming)

---

## 1. Contexto

Hoy el sistema (`apex-leads`) está acoplado a un único producto: **APEX** (agencia de
desarrollo web). Esto se manifiesta en cuatro lugares del código:

- **Tabla `apex_info`** — almacena lo que la IA sabe ("servicios", "precios", "faqs", etc.).
  Es global, no tiene noción de "a qué producto pertenece".
- **`leads` no tiene noción de proyecto** — un lead es solo (rubro, zona, teléfono); se asume
  que todos van a recibir el pitch de APEX.
- **`prompts.ts`** hardcodea "Sos Manuel, parte del equipo de APEX, una agencia de
  desarrollo web y apps en Buenos Aires…" en `SYSTEM_PROMPT_BASE`. Las objeciones
  específicas ("Ya tengo web") también viven ahí.
- **Búsqueda en Google Places** filtra negocios sin web (`if (tieneWeb) continue` en
  [google-places/search.ts](../../../apex-leads/src/lib/google-places/search.ts)) porque
  APEX ofrece páginas web. Para Assistify/Handy/botlode ese filtro no aplica.

Manuel necesita ahora correr **cuatro productos en paralelo** desde el mismo panel:

| Proyecto   | Qué vende                                | Búsqueda                               |
| ---------- | ---------------------------------------- | -------------------------------------- |
| APEX       | Páginas web y apps                       | Comercios locales **sin web**          |
| Assistify  | App para gestionar talleres con cobro mensual | Talleres (cerámica, música, arte…) |
| Handy      | (a definir por Manuel)                   | Oficios (plomero, electricista, gasista…) |
| botlode    | Chatbots para clientes de agencias       | Agencias de marketing                  |

**Requisito clave:** los pozos de clientes están **separados** por proyecto y el bot
**nunca puede mezclar contexto** entre ellos. Si llega un mensaje de un lead de
Assistify, el bot tiene que responder con la info de Assistify, no con la de APEX.

## 2. Decisiones tomadas durante el brainstorming

1. **Todo cambia por proyecto:** información que usa la IA, criterio de búsqueda,
   primer mensaje outbound, y la presentación del bot. Lo único que se mantiene
   transversal es la **personalidad/tono** del agente (las 7 reglas, hard_rules,
   voice, format, objection_handling general).
2. **Pozos separados, no mezclar.** El bot solo carga `project_info` filtrada por
   el `project_id` del lead. Garantía estructural, no de prompt.
3. **Reemplazar "Agente IA" por "Proyectos" en el sidebar.** Toggle global del
   bot se mueve a `/configuracion`.
4. **Selector de proyecto en "Nuevo Lead".** El proyecto define qué chips de rubro
   se muestran y si se aplica el filtro "sin web".
5. **Un rubro por búsqueda.** Manuel prefiere control de cuota; los chips son
   accesos rápidos para autocompletar, no multi-select. (Razón técnica:
   `searchText` de Places limita a 20 resultados por llamada, así que poner
   varios rubros en la misma query no trae más resultados — lo que sí trae más
   es hacer N llamadas, pero eso multiplica el consumo de cuota.)
6. **No se suma contador en sidebar ni filtro de proyecto en inbox/leads en V1.**
   YAGNI por ahora; queda para iteración posterior si Manuel lo necesita.
7. **Enfoque arquitectónico: una tabla `projects` + columna `project_id` en
   `leads` y `project_info`.** Descartados: tablas separadas por proyecto
   (`leads_apex`, `leads_handy`…) y mantener `apex_info` aparte de los otros.

## 3. Modelo de datos

### 3.1 Tabla nueva `projects`

```sql
CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,                   -- 'apex' | 'assistify' | 'handy' | 'botlode'
  nombre text NOT NULL,                        -- 'APEX', 'Assistify', etc.
  descripcion text NOT NULL DEFAULT '',        -- propuesta de valor corta
  url_publica text,                            -- ej. 'www.theapexweb.com'
  filtro_sin_web boolean NOT NULL DEFAULT false,
  rubros_sugeridos text[] NOT NULL DEFAULT '{}',
  plantilla_primer_mensaje text NOT NULL DEFAULT '',
  activo boolean NOT NULL DEFAULT true,
  orden int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX projects_slug_idx ON public.projects(slug);
```

**Seed inicial** (mismo migration script):

- `apex` — `filtro_sin_web=true`, `nombre='APEX'`, `descripcion` = la línea actual
  del prompt ("agencia de desarrollo web y apps en Buenos Aires"), `url_publica =
  'www.theapexweb.com'`, `rubros_sugeridos` = lista derivada del código actual
  (los que aparecen en `rubro-tags.ts`), `plantilla_primer_mensaje` = se rellena
  con la lógica actual de generación de primer mensaje (extraerla a texto).
- `assistify`, `handy`, `botlode` — se insertan con `nombre` y `descripcion`
  básicos; `rubros_sugeridos = []`, `plantilla_primer_mensaje = ''` (Manuel los
  completa desde el panel después de la migración).

### 3.2 Cambios en `leads`

```sql
ALTER TABLE public.leads ADD COLUMN project_id uuid REFERENCES public.projects(id);
UPDATE public.leads SET project_id = (SELECT id FROM public.projects WHERE slug='apex');
ALTER TABLE public.leads ALTER COLUMN project_id SET NOT NULL;
CREATE INDEX leads_project_id_idx ON public.leads(project_id);
```

Todos los leads existentes pasan a APEX (consistente con el estado actual:
todos los leads de la base son del producto APEX).

### 3.3 Renombrar `apex_info` → `project_info`

```sql
ALTER TABLE public.apex_info RENAME TO project_info;
ALTER TABLE public.project_info ADD COLUMN project_id uuid REFERENCES public.projects(id);
UPDATE public.project_info SET project_id = (SELECT id FROM public.projects WHERE slug='apex');
ALTER TABLE public.project_info ALTER COLUMN project_id SET NOT NULL;
CREATE INDEX project_info_project_id_idx ON public.project_info(project_id);
```

Estructura final: `(id, project_id, categoria, titulo, contenido, activo, created_at)`.

### 3.4 Tipos TypeScript

Regenerar `src/types/supabase.ts` con `supabase gen types typescript` después de
aplicar la migración. Esto actualiza las definiciones de `leads`, `apex_info` (ya
no existirá), y suma `projects` y `project_info`.

## 4. UI

### 4.1 Sidebar

- Quitar item "Agente IA" (`/agente`).
- Agregar item "Proyectos" con icono apropiado (`Briefcase` o similar). Al hacer
  click, se expande un dropdown con los 4 proyectos (orden = `projects.orden`).
  Cada item linkea a `/proyectos/[slug]`.
- Mover el toggle "Agente activo/inactivo" global a `/configuracion`. Es un
  toggle ON/OFF como los otros que ya viven ahí (decision_engine, emoji_no_reply,
  etc.).

### 4.2 Página `/proyectos/[slug]`

Mismo layout para los 4 proyectos. Cuatro secciones verticales con bordes
visuales (cards) ya alineadas al sistema de diseño actual (`bg-apex-card`,
`border-apex-border`):

**4.2.1 Identidad**
- Input "Nombre" (text)
- Input "URL pública" (text, opcional)
- Textarea "Descripción para la IA" — qué es el producto, en una o dos líneas
  ("Assistify es una app para que talleres gestionen alumnos, cobros mensuales
  y asistencia"). Esta descripción se inyecta al system prompt.

**4.2.2 Búsqueda**
- Toggle "Filtrar solo negocios sin web" (default según el proyecto)
- Editor de rubros sugeridos:
  - Lista de chips, cada uno con un botón "X" para borrar
  - Input + botón "Agregar" para sumar uno nuevo
  - Persistencia: cada cambio guarda en `projects.rubros_sugeridos` (array)

**4.2.3 Plantilla del primer mensaje**
- Textarea grande (10-12 filas)
- Texto de ayuda: "Esta es la instrucción que la IA usa para generar el primer
  mensaje outbound. Incluí cómo presentarte y qué proponer."
- Persiste en `projects.plantilla_primer_mensaje`.

**4.2.4 Información para la IA** (la UI actual de `/agente` movida acá)
- Botón "Agregar" arriba a la derecha
- Form de creación/edición: categoría (select: servicios, precios, proceso,
  portfolio, faqs, diferencial), título (input), contenido (textarea)
- Lista de cards agrupadas por categoría, con botones editar/borrar
- Todas las queries filtran por `project_id` del proyecto actual

### 4.3 `/leads/nuevo`

Cambios:

- Agregar **selector de proyecto** arriba del input "Rubro" (default = APEX para
  no romper el flujo actual del usuario).
- Debajo del input "Rubro", mostrar los chips de rubros sugeridos del proyecto
  seleccionado. Click en un chip → autocompleta el campo.
- Indicador visual del filtro de búsqueda según el proyecto:
  - Si `filtro_sin_web=true`: "Buscando solo negocios sin web"
  - Si `filtro_sin_web=false`: "Mostrando todos los resultados"
- Al hacer la búsqueda, el endpoint `/api/leads/buscar` recibe `project_id` y
  decide si aplica `if (tieneWeb) continue` o no.
- Al encolar (`/api/leads/bulk-queue`), cada lead se inserta con el `project_id`
  del proyecto seleccionado.

### 4.4 `/configuracion`

Sumar el toggle "Agente IA activo/inactivo" que hoy vive en `/agente`. Misma
mecánica que los otros toggles existentes (`agente_activo` en la tabla
`configuracion`).

## 5. Backend

### 5.1 Generación de respuesta (`src/lib/agente.ts`)

Hoy en `generarRespuestaAgente`:

```ts
const { data: apexInfo } = await supabase
  .from('apex_info')
  .select('categoria, titulo, contenido')
  .eq('activo', true)
```

Pasa a:

```ts
const { data: project } = await supabase
  .from('projects')
  .select('*')
  .eq('id', lead.project_id)
  .single()

const { data: projectInfo } = await supabase
  .from('project_info')
  .select('categoria, titulo, contenido')
  .eq('project_id', lead.project_id)
  .eq('activo', true)
```

Y `buildAgentPrompt` recibe el `project` además del lead y el contexto. La info
sigue mezclándose en el mismo formato `[CATEGORIA] titulo\ncontenido`, pero
ahora viene scopeada.

### 5.2 Prompts (`src/lib/prompts.ts`)

`SYSTEM_PROMPT_BASE` deja de tener la línea hardcodeada `"Sos Manuel, parte del
equipo de APEX, una agencia de desarrollo web…"`. En su lugar:

```ts
function buildIdentidadProyecto(project: ProjectRow): string {
  return `Sos Manuel, parte del equipo de ${project.nombre}. ${project.descripcion}`
}
```

El resto del prompt (las 7 preguntas del checklist, hard_rules, voice, format,
objection_handling, examples) queda intacto — es buena guía conversacional
agnóstica al producto.

**Excepción: objeciones específicas de APEX.** Los siguientes ejemplos del
prompt actual son específicos del producto APEX:
- "Ya tengo web." → reconocer y preguntar si funciona.
- "Mandame info por mail." → "el boceto se hace acá por WhatsApp".
- Toda la mecánica del "boceto en 24 horas".

Estos ejemplos se mantienen **solo cuando el proyecto activo es APEX**. Para los
otros tres proyectos, se omiten. Implementación: una sección opcional
`<objection_handling_proyecto>` que se inyecta solo si el proyecto tiene
configurado un texto en un nuevo campo `objeciones_especificas` (opcional, sin
DB nueva, podría vivir en `projects.descripcion` o sumarse como columna en V2).

Para V1, **mantenemos los ejemplos específicos de APEX condicionados al
`project.slug === 'apex'`** dentro de la función `buildAgentPrompt`. Es la
implementación más simple y refleja la realidad: solo APEX tiene esos casos
maduros en este momento.

### 5.3 Primer mensaje (`src/lib/generar-primer-mensaje.ts`)

Hoy hardcodea la propuesta de APEX. Cambio:

- Recibe el `project` (no solo el lead).
- Usa `project.plantilla_primer_mensaje` como instrucción base para la IA.
- Si la plantilla está vacía (caso inicial de Assistify/Handy/botlode antes de
  que Manuel la complete), el endpoint que dispara el envío del primer mensaje
  devuelve un error claro y el cron salta a ese lead — no genera mensajes
  inventados.

### 5.4 Followups (`src/lib/generar-followup.ts`)

Mismo patrón: recibe `project`, usa la identidad y descripción para no
re-presentarse mal. La plantilla del primer mensaje también se le pasa como
contexto para que sepa qué propuesta quedó pendiente.

### 5.5 Búsqueda en Google Places (`src/lib/google-places/search.ts`)

`parseResultados` actualmente tiene:

```ts
if (tieneWeb) continue // queremos solo negocios sin web
```

Pasa a recibir un flag `filtroSinWeb` desde el caller:

```ts
if (filtroSinWeb && tieneWeb) continue
```

`searchPlaces(rubro, zona, signal)` cambia a
`searchPlaces(rubro, zona, { filtroSinWeb }, signal)`. El endpoint
`/api/leads/buscar` carga el proyecto desde `project_id` (request body) y pasa
el flag.

## 6. Migración

Una sola migración SQL ejecuta los cambios en este orden:

1. Crear tabla `projects` con seed de los 4 proyectos.
2. Agregar `project_id` a `leads` como nullable.
3. UPDATE de leads existentes a `project_id = apex`.
4. Hacer `project_id` NOT NULL en `leads`.
5. Renombrar `apex_info` → `project_info`.
6. Agregar `project_id` a `project_info` como nullable.
7. UPDATE de info existente a `project_id = apex`.
8. Hacer `project_id` NOT NULL en `project_info`.

**Una vez aplicada, regenerar los types TypeScript** y arreglar los errores de
compilación (cada `from('apex_info')` pasa a `from('project_info')` con un
`.eq('project_id', ...)` extra).

**Backward compat:** los leads y la info de APEX siguen funcionando como hoy,
porque APEX es un proyecto más con la misma configuración que tenía implícita
antes.

**Plan de rollback** si algo sale mal en producción: la migración es reversible
con `ALTER TABLE project_info RENAME TO apex_info` + drop columnas
`project_id`. No hay pérdida de datos.

## 7. Fuera de scope (V1)

- Contadores de leads pendientes por proyecto en el sidebar.
- Filtro por proyecto en `/conversaciones` (inbox) y `/leads`.
- UI para crear nuevos proyectos desde el panel (los 4 se cargan vía seed; si
  Manuel quiere un quinto en el futuro, se hace por SQL directo o se agrega la
  UI en una segunda iteración).
- Cuotas separadas de Google Places por proyecto (siguen compartidas).
- Cuotas de envío de WhatsApp por proyecto (siguen compartidas — los senders
  rotan entre todos los proyectos).
- Personalidad/tono distinto por proyecto (Manuel pidió mantener "profesional"
  como común denominador).
- Estadísticas por proyecto (conversiones, tasa de respuesta, etc.) — el
  dashboard sigue agregando todo junto.

## 8. Cosas a tener en cuenta durante la implementación

- **Renombrar `apex_info` → `project_info`** rompe TODOS los lugares que la
  referencian. Hay que arreglarlos en un solo pasada para que el build no
  quede roto entre commits. Mismo para los `from('apex_info')` en
  `src/lib/agente.ts`, `src/app/api/webhook/evolution/route.ts`,
  `src/app/api/agente/info/route.ts`, etc.
- El **endpoint `/api/agente/info`** (GET/POST/PUT/DELETE) hoy es global. Tiene
  que pasar a aceptar/devolver `project_id`. Cambio: el query string o body
  ahora trae `project_id` y todas las operaciones lo respetan.
- El **endpoint `/api/agente/config`** sigue manejando el toggle global
  `agente_activo` — no cambia, solo el lugar de la UI se mueve a
  `/configuracion`.
- El **sistema de saneamiento por vertical** (`sanitizarApexInfoPorVertical`) NO
  se toca. Sigue siendo útil dentro del scope del proyecto: por ejemplo, dentro
  de Assistify, si Manuel carga un bloque en `project_info` con jerga de
  cerámica y el lead es de música, el sanitizador puede filtrarlo. Renombrar
  la función a `sanitizarProjectInfoPorVertical` por coherencia.
- **Tests existentes** (`apex-leads/__tests__/*`) que toquen `apex_info` o
  `leads` hay que actualizarlos para mockear `project_info` con `project_id`.
  Auditarlos como parte del plan.
- **Logos y branding del programa** (`APEX` en el sidebar, `APEX Lead Engine`
  en el footer del logo) NO se tocan. El programa interno de Manuel se llama
  APEX; los "proyectos" son los productos que vende.
- Existe una **constante de "rubros de oficios" para APEX** implícita en
  `rubro-tags.ts` (mapeo a tags de OpenStreetMap). Esa lógica de mapeo se
  mantiene global — no es project-specific, sirve para cualquier proyecto que
  busque por rubro en OSM/Overpass.

## 9. Definition of Done

- [ ] Migración SQL aplicada en local y en producción.
- [ ] Types TypeScript regenerados; build pasa sin errores.
- [ ] Sidebar muestra "Proyectos" con dropdown de los 4 (APEX, Assistify, Handy,
      botlode).
- [ ] Panel `/proyectos/[slug]` funcional para los 4: edición de identidad,
      búsqueda, plantilla, info — y guarda en DB filtrando por `project_id`.
- [ ] `/leads/nuevo` tiene selector de proyecto, chips de rubros sugeridos del
      proyecto, e indicador del filtro "sin web".
- [ ] Bot al responder un mensaje de un lead de APEX usa solo info de APEX; lo
      mismo para los otros 3 proyectos. Verificado con un test manual: cargar un
      bloque de info en Assistify ("nuestra app cuesta $10/mes"), mandar un
      mensaje a un lead de Assistify, confirmar que la respuesta no menciona
      precios de APEX.
- [ ] Cron de primer envío genera mensajes con la plantilla del proyecto del
      lead, o salta si la plantilla está vacía.
- [ ] El toggle "Agente IA activo/inactivo" funciona desde `/configuracion`.
- [ ] El item "Agente IA" del sidebar fue removido.
- [ ] Tests existentes pasan después de la actualización.
