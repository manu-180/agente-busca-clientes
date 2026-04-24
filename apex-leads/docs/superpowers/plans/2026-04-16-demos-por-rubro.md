# Demos por rubro (Supabase + Panel premium) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar demos por rubro con persistencia en Supabase, panel premium para administrarlas (chips editables), y uso automático de demos en el primer mensaje manual y en el agente de respuesta (match fuerte o nada).

**Architecture:** Fuente de verdad en tabla `demos_rubro` (Supabase). Un matcher determinístico selecciona `demo` o `null` usando keywords fuertes/débiles/negativas y un umbral de “match fuerte”. El resultado se inyecta como contexto controlado en los prompts de Claude y se evita spam con heurística basada en historial (solo mensajes del agente).

**Tech Stack:** Next.js App Router, Supabase (service role en API routes), Tailwind, Lucide, Anthropic SDK (Claude), Wassenger webhook.

---

## File map (qué se crea / modifica)

**Create**
- `src/lib/demo-normalize.ts` — normalización de texto (tildes, puntuación, URLs, formato WhatsApp)
- `src/lib/demo-match.ts` — scoring + selección “match fuerte o nada”
- `src/lib/demos-repo.ts` — acceso a Supabase (listar demos activas / CRUD desde API)
- `src/app/api/demos/route.ts` — GET/POST/PUT/DELETE CRUD
- `src/app/api/demos/test/route.ts` — endpoint para probar matcher desde UI
- `src/app/demos/page.tsx` — panel premium de demos
- `src/components/demos/KeywordsChips.tsx` — editor de chips (tags) para arrays
- `src/components/demos/DemoCard.tsx` — card premium por demo (opcional, si se separa)

**Modify**
- `src/components/layout/sidebar.tsx` — agregar item “Demos”
- `src/app/api/leads/generar-mensaje/route.ts` — inyectar demo en primer mensaje manual (outbound)
- `src/lib/prompts.ts` — ampliar `buildAgentPrompt` para aceptar `demoContext?`
- `src/app/api/webhook/wassenger/route.ts` — calcular demo por texto + rubro; evitar repetición; actualizar `lead.rubro` si “Por definir”

**Docs**
- `docs/superpowers/specs/2026-04-16-demos-por-rubro-design.md` (ya existe)

---

## Task 1: Migración / preparación Supabase (tabla `demos_rubro`)

**Files:**
- Create: `supabase/migrations/<timestamp>_create_demos_rubro.sql` (o el path estándar del repo si existe)
- (Alternativa si no hay carpeta de migraciones en repo): documentar SQL para correr en Supabase UI.

- [ ] **Step 1: Confirmar si el repo tiene carpeta de migraciones Supabase**
  - Buscar si existe `supabase/migrations/` o scripts SQL.

- [ ] **Step 2: Escribir SQL de creación de tabla `demos_rubro`**
  - Campos: `id`, `slug unique`, `rubro_label`, `url`, `strong_keywords text[]`, `weak_keywords text[]`, `negative_keywords text[]`, `active bool`, `priority int`, `created_at`, `updated_at`.
  - Defaults: arrays vacíos, `active true`, `priority 0`.

- [ ] **Step 3: (Opcional) Trigger updated_at**
  - Si en el proyecto ya hay pattern para `updated_at`, replicarlo. Si no, dejarlo sin trigger (YAGNI).

- [ ] **Step 4: Seed mínimo**
  - Insert demo inicial gym (`slug=gym`, `rubro_label=gimnasios`, `url=https://gym.theapexweb.com`, keywords según spec).
  - Hacer seed idempotente: `ON CONFLICT (slug) DO NOTHING`.

- [ ] **Step 5: Verificar tabla desde API service role**
  - Probar una consulta simple en un endpoint temporal o consola (si hay).

- [ ] **Step 6: Commit**
  - Commit solo si el usuario lo pide (política del repo en esta sesión).

---

## Task 2: Repo de acceso a demos (Supabase) + tipos

**Files:**
- Create: `src/lib/demos-repo.ts`
- Modify: `src/types/index.ts` (si corresponde agregar tipo `DemoRubro`)

- [ ] **Step 1: Definir tipo `DemoRubro`**
  - Campos: `id`, `slug`, `rubro_label`, `url`, `strong_keywords`, `weak_keywords`, `negative_keywords`, `active`, `priority`.

- [ ] **Step 2: Implementar funciones de lectura**
  - `listDemos({ includeInactive?: boolean })`
  - `listActiveDemos()` (para matcher runtime)

- [ ] **Step 3: Implementar funciones CRUD**
  - `createDemo(payload)`
  - `updateDemo(id, payload)`
  - `deleteDemo(id)`

- [ ] **Step 4: Minimal validation (server-side)**
  - `slug` no vacío, `url` SOLO `https://` (whitelist), `strong_keywords` array.
  - Normalizar arrays: trim, lower, sin duplicados, sin vacíos.

---

## Task 3: Normalización + matcher determinístico (match fuerte o nada)

**Files:**
- Create: `src/lib/demo-normalize.ts`
- Create: `src/lib/demo-match.ts`

- [ ] **Step 1: Implementar normalizador**
  - `normalizeTextForMatch(input: string): string`
  - `stripUrls()`, `stripWhatsappFormatting()`, `stripPunctuation()`.

- [ ] **Step 2: Implementar matcher**
  - Config: `STRONG_THRESHOLD=100`, `strong_hit=100`, `weak_hit=50`, `MIN_GAP=30`
  - Word boundaries / phrase match para keywords fuertes.
  - Output: `{ demo, score, reason }` donde `reason` enumera keywords encontradas.

- [ ] **Step 3: Smoke tests manuales (via `/api/demos/test`)**
  - Casos:
    - “tengo un gym” → demo `gym`
    - “centro de entrenamiento” → sin match fuerte
    - “gomería” → sin match fuerte

- [ ] **Step 4: (Opcional) Logging helper**
  - Helper para loggear `{matchedSlug, score, hitsStrong, hitsWeak}` en endpoints.

---

## Task 4: API Routes para panel (CRUD + test)

**Files:**
- Create: `src/app/api/demos/route.ts`
- Create: `src/app/api/demos/test/route.ts`

- [ ] **Step 1: Implementar `GET /api/demos`**
  - Devuelve todas (incluye inactive) ordenadas por `priority desc, created_at desc`.

- [ ] **Step 2: Implementar `POST /api/demos`**
  - Crea demo con payload validado/normalizado.

- [ ] **Step 3: Implementar `PUT /api/demos`**
  - Actualiza por `id` en body (pattern similar a otros endpoints del repo).

- [ ] **Step 4: Implementar `DELETE /api/demos`**
  - Borra por `id` en body.

- [ ] **Step 5: Implementar `POST /api/demos/test`**
  - Input: `{ texto: string, rubro?: string }`
  - Busca demos activas desde Supabase, corre `matchDemo`, devuelve `{ demo, score, reason }`.

- [ ] **Step 6: Probar endpoints manualmente**
  - Con fetch desde navegador o consola.

---

## Task 5: Panel premium `/demos` + chips editables

**Files:**
- Create: `src/app/demos/page.tsx`
- Create: `src/components/demos/KeywordsChips.tsx`
- (Optional) Create: `src/components/demos/DemoCard.tsx`
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Agregar item en sidebar**
  - `label: 'Demos'`, `href: '/demos'`, icono sugerido `Globe` o `Sparkles`.

- [ ] **Step 2: UI base de página**
  - Header + subtitle (mismo look de `Agente IA`).
  - Botón “Agregar demo”.

- [ ] **Step 3: Implementar listado**
  - `useEffect` fetch `GET /api/demos`.
  - Cards con: título, slug badge, URL actions, toggle active, acciones editar/borrar.

- [ ] **Step 4: Implementar form create/edit**
  - Inline card (estilo `Agente IA`) o modal liviano.
  - Campos: slug, rubro_label, url, priority, active.
  - Chips: strong/weak/negative con `KeywordsChips`.

- [ ] **Step 5: Implementar `KeywordsChips` (premium)**
  - Input + Enter/coma → agrega chip
  - Chip con “x” para remover
  - Prevent duplicates (case-insensitive)
  - Visual: strong (lime), weak (neutral/blue), negative (red)

- [ ] **Step 6: Implementar “Test rápido”**
  - Textarea + botón “Probar”
  - Llama `POST /api/demos/test`
  - Muestra resultado con card: demo/score/keywords que matchearon.

- [ ] **Step 7: Verificar responsive**
  - Desktop 3 columns si aplica; mobile 1 column.

---

## Task 6: Integración con primer mensaje manual (generar-mensaje)

**Files:**
- Modify: `src/app/api/leads/generar-mensaje/route.ts`

- [ ] **Step 1: Integrar Supabase en el endpoint**
  - Importar `createSupabaseServer()` y el repo `listActiveDemos()`.

- [ ] **Step 2: Traer demos activas (con fallback)**
  - `try/catch`: si falla Supabase, seguir generando mensaje **sin demo** (no romper el endpoint).

- [ ] **Step 3: Calcular demo por rubro/descripcion**
  - Inputs: rubro, descripcion, nombre, zona.

- [ ] **Step 4: Inyectar contexto de demo en prompt**
  - Si hay match fuerte:
    - Incluir “Demo disponible: <rubro_label> — <url>”
    - Regla: incluir 1 línea con la demo (copy vendedor profesional).
  - Si no: no mencionar demos.

- [ ] **Step 5: Verificar límites de caracteres**
  - Mantener <= 300 chars (ya lo pide el prompt).

---

## Task 7: Integración con agente de respuestas (webhook Wassenger + prompts)

**Files:**
- Modify: `src/lib/prompts.ts`
- Modify: `src/app/api/webhook/wassenger/route.ts`

- [ ] **Step 1: Extender `buildAgentPrompt`**
  - Agregar parámetro opcional `demoContext?: { rubroLabel: string; url: string } | null`
  - Inyectar bloque “DEMOS DISPONIBLES (si aplica)” con reglas anti-spam.

- [ ] **Step 2: Calcular demo en webhook**
  - Demos activas desde Supabase
  - Inputs: `lead.rubro` (si no es “Por definir”), `mensaje` entrante, e historial (idealmente últimos mensajes del cliente).
  - Fallback: si falla Supabase al cargar demos, responder sin demo (no bloquear al agente).

- [ ] **Step 3: Cache TTL (performance)**
  - Cache in-memory de `listActiveDemos()` con TTL 60–120s para el webhook.

- [ ] **Step 4: Anti-spam**
  - Si `historial` ya contiene la URL en mensajes del rol agente → no pasar demoContext (o pasar null).

- [ ] **Step 5: Actualizar rubro si estaba “Por definir” (condición estricta)**
  - Solo si `lead.rubro === 'Por definir'` y match fuerte: `update leads set rubro = demo.rubro_label`.
  - Loggear el cambio (lead id + rubro viejo/nuevo).

- [ ] **Step 6: Smoke test**
  - Simular payload webhook con mensaje “tengo un gym” → respuesta incluye demo 1 vez.

---

## Task 8: Verificación final

- [ ] **Step 1: Typecheck / build**
  - Run: `npm run build`
  - Expected: success

- [ ] **Step 2: Lints (si existen)**
  - Run: `npm run lint`
  - Expected: no new errors

- [ ] **Step 3: Manual QA**
  - En `/demos`: crear demo gym, probar “tengo un gym” en Test rápido → matchea.
  - En “Nuevo Lead”: generar mensaje para rubro gimnasio → incluye demo.

---

## Execution Notes / Guardrails

- No ofrecer demo si el match no es fuerte.
- No repetir links de demo si ya los mandó el agente en esa conversación.
- Validar/normalizar keywords al guardar para evitar basura en DB.
- Mantener copy profesional y corto (WhatsApp).

