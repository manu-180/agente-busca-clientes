# SESSION-EVO-04 — Schema + QR Onboarding Premium + Evolution Instance Helpers

**Modelo:** claude-sonnet-4-6 (o sonnet último)
**Repo:** `C:\MisProyectos\bots_ia\agente_busca_clientes` — branch `main` (commitear directo, sin feature branches)
**App:** `apex-leads/` (Next.js 15.5, Vercel, `leads.theapexweb.com`)
**Supabase project:** `hpbxscfbnhspeckdmkvu`
**Estimado:** 60-90 min

---

## Lectura obligatoria al inicio de la sesión

1. `docs/superpowers/specs/2026-04-29-evolution-pool-design.md` — spec doc canónico (toda la arquitectura)
2. `docs/migration/evolution-api/PROGRESS.md` — estado actual
3. `docs/migration/evolution-api/MASTER-PLAN.md` — contexto histórico de la migración Twilio→Evolution

---

## Contexto

**Lo que ya existe (no rehacer):**
- `apex-leads/src/lib/evolution.ts` — función `enviarMensajeEvolution(telefono, texto, instanceName)` (envío de mensajes, no de gestión de instancias).
- `apex-leads/src/app/api/webhook/evolution/route.ts` — webhook de Evolution funcionando, hace lookup de sender por `instance_name`.
- `apex-leads/src/app/api/senders/route.ts` — CRUD básico GET/POST/PATCH/DELETE, pero el POST asume `provider='twilio'` hardcoded en el form.
- `apex-leads/src/app/senders/page.tsx` — UI de senders con cards y modal CRUD, pero hardcoded a `provider='twilio'` en el select y NO tiene flujo de QR.
- Tabla `senders` con: `id, alias, provider, phone_number, descripcion, color, activo, es_legacy, stats_messages_sent, instance_name, created_at, updated_at`.
- Evolution API en Railway: `https://evolution-api-production-3571.up.railway.app`. API key en env var `EVOLUTION_API_KEY`. Una instancia ya existente `wa-sim01` (sin conectar).

**Lo que falta (esta sesión):** schema completo del pool, helpers de gestión de instancias Evolution, API routes para QR/state/reconnect/orphans/adopt, y la UI premium del modal de onboarding.

---

## Pre-requisitos que Manuel debe confirmar antes de empezar

1. **Railway HEALTHY (validado 2026-04-29 22:51 ART).** El servicio Evolution corre con imagen **`evoapicloud/evolution-api:v2.3.7`** (no la abandonada `atendai/evolution-api:latest` que tenía Baileys clavado en una versión que WhatsApp ya no acepta). DATABASE_ENABLED=true aplicado. QR se genera OK al primer intento. Existe una instancia `wa-sim01` huérfana en Evolution sin escanear, lista para que la UI nueva la adopte en Tarea 5. NO escanear `wa-sim01` antes de empezar la sesión — la idea es validar el flow completo desde la UI premium.

2. **Vercel env vars:**
   - `EVOLUTION_API_URL=https://evolution-api-production-3571.up.railway.app`
   - `EVOLUTION_API_KEY=<la misma del Railway>`
   - `NEXT_PUBLIC_APP_URL=https://leads.theapexweb.com` (o equivalente, para construir el webhookUrl al crear instancias)

3. **MCP Supabase conectado.** El proyecto tiene MCP de Supabase. Usalo para aplicar la migración SQL sin SSH manual. Project id: `hpbxscfbnhspeckdmkvu`.

4. **Estado actual de la tabla `senders` (verificado 2026-04-29 vía MCP):** hay 4 senders TODOS `provider='twilio'` (APEX, APEX 2, Assistify Respaldo, new apex). NINGUNO tiene `instance_name`. **El cron actual no está enviando nada via Evolution** porque su query es `WHERE provider='evolution' AND instance_name IS NOT NULL`. Cuando esta sesión adopte `wa-sim01` desde la UI, será el primer sender Evolution real. **NO TOCAR los 4 senders Twilio existentes** — quedan ahí porque hay conversaciones viejas con FK a sus IDs. Los inactivos siguen inactivos; "Assistify Respaldo" (activo=true pero provider=twilio) lo dejamos como está — no participa del pool Evolution.

---

## TAREA 0 — Verificación (5 min)

```bash
git status   # debe estar limpio
git log --oneline -3  # último commit es de SESSION-EVO-02+03
```

Si hay cambios pendientes, abortar y avisar a Manuel.

Verificá que el archivo `docs/superpowers/specs/2026-04-29-evolution-pool-design.md` existe y leelo COMPLETO antes de continuar.

---

## TAREA 1 — Migración SQL (10 min)

Aplicar la migración via MCP Supabase. Crear archivo `apex-leads/supabase-migration-evolution-pool.sql`:

```sql
-- Migración: Evolution Pool — round-robin LRU + onboarding premium
-- Fecha: 2026-04-29
-- Project: hpbxscfbnhspeckdmkvu
-- Sesión: SESSION-EVO-04

ALTER TABLE senders
  ADD COLUMN IF NOT EXISTS daily_limit INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS msgs_today INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reset_date DATE,
  ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS connected BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qr_requested_at TIMESTAMPTZ;

-- Índice para selectNextSender (LRU least-used)
CREATE INDEX IF NOT EXISTS idx_senders_pool_lookup
  ON senders (provider, activo, connected, msgs_today, last_sent_at)
  WHERE provider = 'evolution';

COMMENT ON COLUMN senders.msgs_today IS
  'Reemplaza configuracion[<instance>_primer_enviados_hoy]. Reset diario en cron al inicio del tick.';
```

Aplicar con MCP Supabase tool `apply_migration`. Verificar con `list_tables` que las columnas aparecen en `senders`.

---

## TAREA 2 — `apex-leads/src/lib/evolution-instance.ts` (20 min)

Nuevo archivo. Helpers para hablar con Evolution API. Aísla URLs y headers.

Firmas requeridas:

```typescript
import { isTelefonoHardBlocked } from '@/lib/phone-blocklist'

function getConfig(): { url: string; key: string }
// Reusa lógica de lib/evolution.ts. Lanza error si faltan env vars.

export async function createInstance(name: string, webhookUrl: string): Promise<{ ok: true }>
// POST /instance/create con { instanceName, integration: 'WHATSAPP-BAILEYS', qrcode: true,
//   webhook: { url, byEvents: false, base64: false, events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'] } }
// Lanza si Evolution responde !ok.

export async function connectInstance(name: string): Promise<{ base64: string | null; code: string | null }>
// GET /instance/connect/{name}. Maneja ambos formatos de respuesta:
//   - { base64, code, count } (formato típico)
//   - { qrcode: { base64, code } } (algunos forks)
// Strip 'data:image/png;base64,' del base64 si viene presente.

export async function getInstanceState(name: string): Promise<'close' | 'connecting' | 'open' | 'unknown'>
// GET /instance/connectionState/{name}. Mapea data.instance.state.

export async function restartInstance(name: string): Promise<void>
// POST /instance/restart/{name}.

export async function logoutInstance(name: string): Promise<void>
// DELETE /instance/logout/{name}. Idempotente: ignora 404.

export async function deleteInstance(name: string): Promise<void>
// DELETE /instance/delete/{name}. Idempotente: ignora 404.

export async function fetchAllInstances(): Promise<Array<{ name: string; state: string; phone: string | null }>>
// GET /instance/fetchInstances. Devuelve lista normalizada.

export async function fetchPhoneNumber(name: string): Promise<string | null>
// Lo extrae de fetchAllInstances() filtrando por name. Devuelve formato '+549...' o null.

export async function setWebhook(name: string, webhookUrl: string): Promise<void>
// POST /webhook/set/{name} con { webhook: { enabled: true, url, byEvents: false, events: [...] } }
```

**Errores:** todos los helpers lanzan `Error` con mensaje legible si Evolution responde !ok. El caller los captura.

**Tests inline (smoke en dev):** no agregar Jest test files acá — los tests del pool van en EVO-05 y los E2E en EVO-08.

---

## TAREA 3 — API routes nuevos (25 min)

### 3.1 `apex-leads/src/app/api/senders/[id]/qr/route.ts` (GET)

```typescript
// GET /api/senders/{id}/qr → llama Evolution connect, retorna { base64, code }.
// Si la respuesta no trae base64 (ej. {count:0}), llama restartInstance() y reintenta 1 vez.
// UPDATE senders SET qr_requested_at = NOW() WHERE id=$1.
```

### 3.2 `apex-leads/src/app/api/senders/[id]/state/route.ts` (GET)

```typescript
// GET /api/senders/{id}/state → llama Evolution getInstanceState().
// Si state === 'open' Y senders.connected === false:
//   - fetchPhoneNumber() para obtener el número real
//   - UPDATE senders SET connected=true, connected_at=NOW(), phone_number=<num> WHERE id=$1
// Retorna { state, phone_number }.
```

### 3.3 `apex-leads/src/app/api/senders/[id]/reconnect/route.ts` (POST)

```typescript
// POST → restartInstance() + connectInstance(), retorna { base64, code }.
// UPDATE senders SET connected=false, qr_requested_at=NOW() WHERE id=$1.
```

### 3.4 `apex-leads/src/app/api/senders/orphans/route.ts` (GET)

```typescript
// GET → fetchAllInstances() de Evolution, cruza con SELECT instance_name FROM senders WHERE provider='evolution'.
// Devuelve { orphans: [{ name, state, phone }, ...] }.
```

### 3.5 `apex-leads/src/app/api/senders/adopt/route.ts` (POST)

```typescript
// POST { instance_name, alias, daily_limit, color }
// → fetchPhoneNumber(instance_name), getInstanceState(instance_name)
// → INSERT INTO senders (provider='evolution', instance_name, alias, phone_number, daily_limit, color,
//     connected = state === 'open', connected_at = state === 'open' ? NOW() : null, activo=true)
// → setWebhook(instance_name, NEXT_PUBLIC_APP_URL + '/api/webhook/evolution') por las dudas.
// Retorna { sender }.
```

### 3.6 Modificar `apex-leads/src/app/api/senders/route.ts`

**POST modificado:**
- Si `provider === 'evolution'`:
  1. Slug del alias (`SIM 01` → `wa-sim01`, agregar shortid 6 chars al final si ya existe).
  2. `webhookUrl = NEXT_PUBLIC_APP_URL + '/api/webhook/evolution'`.
  3. `createInstance(slug, webhookUrl)`.
  4. `INSERT senders (provider='evolution', instance_name=slug, alias, phone_number=null, daily_limit, color, connected=false, activo=true)`.
  5. Si createInstance falla, propagar el error y NO insertar fila.
- Si `provider !== 'evolution'`: comportamiento actual (legacy, dejar para no romper).

**DELETE modificado:**
- Si `?hard=true`: verificar primero `SELECT count(*) FROM conversaciones WHERE sender_id = $1`. Si > 0, retornar 409 con mensaje. Si 0, llamar `deleteInstance(instance_name)` + DELETE FROM senders.
- Default (sin `?hard`): UPDATE senders SET activo=false (soft delete). NO borrar de Evolution.

---

## TAREA 4 — UI premium del QR onboarding (30 min)

### 4.1 Modificar `apex-leads/src/app/senders/page.tsx`

Cambios concretos al componente existente:

**A. Sacar el campo `provider` del modal Add.** Asume siempre `evolution`. El select de Twilio se elimina.

**B. Modal Add — pantalla 1 (form mínimo):**
- Inputs: `alias` (texto), `daily_limit` (select: 15, 20, 25, 30, custom), `color` (paleta existente).
- Botón "Conectar SIM →" → POST `/api/senders` → si OK, devuelve `sender.id` → cambia a pantalla 2.

**C. Modal Add — pantalla 2 (QR):**
- Loader inicial mientras llega el primer `base64`.
- `<img src={\`data:image/png;base64,\${base64}\`} alt="QR" />` 256x256 con borde apex-lime.
- Countdown desde 40s. Cuando llega a 0 → botón "Regenerar QR" auto-aparece.
- Texto "Esperando conexión..." con `●●●` animados (pulsing).
- **Polling:** cada 2s `GET /api/senders/{id}/state`:
  - Si `state === 'open'` → animación de check verde → toast "✅ SIM conectada como {phone_number}" → cierra modal → `cargar()` para refresh grilla.
  - Si `state === 'close'` y pasaron > 60s → asume QR caducado → mostrar botón Regenerar.
- **Regenerar:** POST `/api/senders/{id}/reconnect` → reemplaza el QR.

**D. Banda de huérfanas (top de la página):**
- Al mount, GET `/api/senders/orphans`.
- Si `orphans.length > 0`, mostrar banda amarilla:
  ```
  ⚠ Detectamos {N} instancia(s) en Evolution sin sender en la DB:
    [wa-sim01 (open)] [Adoptar] [Borrar de Evolution]
  ```
- Click "Adoptar" → modal mini con alias y daily_limit → POST `/api/senders/adopt`.

**E. Cards de senders existentes:**
- Agregar badge en el header: `● connected` (verde) o `● disconnected` (rojo) según `s.connected`.
- Si `s.connected === false`, agregar botón "Reconectar QR" que abre modal pantalla 2 con polling para esa instancia.
- Reemplazar la barra de progreso actual (que muestra ratio de conversaciones) por:
  ```
  msgs hoy: {s.msgs_today}/{s.daily_limit}
  [▓▓▓░░░░░░░] 30%
  ```
- En el modal Editar, agregar input `daily_limit`.

**F. Stats header (mini):**
- Sobre la grilla, antes de las cards, una línea: `Pool hoy: 8/30 msgs · 2/2 SIMs conectadas ●●`.
- Datos vienen de `getCapacityStats()` (lo expone EVO-07, pero por ahora hardcodeá un fetch a `GET /api/senders` y calculá client-side: `total = sum(daily_limit), used = sum(msgs_today), connected = filter(s.connected)`). El endpoint dedicado lo agrega EVO-07.

---

## TAREA 5 — Smoke test manual (10 min)

Con el dev server corriendo (`npm run dev` en `apex-leads/`, puerto 3000):

1. Ir a `http://localhost:3000/senders`.
2. Banda amarilla debe aparecer con `wa-sim01` (la huérfana de Manuel).
3. Click "Adoptar" → escribir alias "SIM 01" → daily_limit 15 → adoptar.
4. Card aparece con badge "disconnected" (porque `wa-sim01` no estaba escaneada).
5. Click "Reconectar QR" → modal pantalla 2 → debe llegar el QR (si no, ver pre-requisito 1).
6. Manuel escanea con WhatsApp del celular de la SIM 01.
7. En 1-2s debe llegar el toast verde + cierre del modal + card en verde.

Si el paso 5 sigue devolviendo `{count:0}`, el problema es Railway DATABASE_ENABLED. Pedir a Manuel que confirme el redeploy.

---

## Verificación final ("sesión completada")

- [ ] Migración SQL aplicada (verificar con MCP Supabase `list_tables` que las 7 columnas nuevas existen en `senders`).
- [ ] `lib/evolution-instance.ts` creado, todos los helpers funcionando (probar manualmente con `curl` o desde la UI).
- [ ] 5 nuevos API routes funcionando (`qr`, `state`, `reconnect`, `orphans`, `adopt`).
- [ ] POST y DELETE de `/api/senders` modificados.
- [ ] UI de `/senders` premium: banda huérfanas, modal 2-pantallas, badge connected/disconnected, botón Reconectar.
- [ ] Smoke manual: SIM 01 conectada exitosamente desde la UI nueva.
- [ ] `tsc --noEmit` desde `apex-leads/` sin errores nuevos.
- [ ] PROGRESS.md actualizado con el resultado.
- [ ] Commit en main: `feat(evolution): SESSION-EVO-04 — schema pool + QR onboarding premium + helpers Evolution`

---

## Fuera de scope (NO hacer)

- Refactor del cron `leads-pendientes`. Va en EVO-06.
- `lib/sender-pool.ts` con `selectNextSender()`. Va en EVO-05.
- Endpoint `/api/senders/capacity` dedicado para dashboard. Va en EVO-07. Por ahora calculá client-side.
- Tests E2E Playwright. Van en EVO-08.
- Sacar la tarjetita 💳 del template (no está, ese cambio va en EVO-08).

---

## Al cerrar la sesión

1. Update `docs/migration/evolution-api/PROGRESS.md`:
   - Marcar `[x] SESSION-EVO-04 (Sonnet) ... COMPLETO (fecha)`.
   - Agregar bloque "### SESSION-EVO-04 (fecha)" con resumen de archivos creados/modificados.
   - Apuntar `Próxima sesión: SESSION-EVO-05`.
2. Commit todo en main con el mensaje arriba.
3. Mostrar a Manuel el comando para abrir la próxima sesión:
   - Modelo: `claude-sonnet-4-6`
   - Archivo a copiar: `docs/migration/evolution-api/prompts/SESSION-EVO-05.md`
