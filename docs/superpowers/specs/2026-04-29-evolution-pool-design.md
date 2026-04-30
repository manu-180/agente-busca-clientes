# Evolution API — Pool de SIMs con Round-Robin LRU + UI Premium QR Onboarding

> **Spec doc canónico.** Diseño autoritativo del feature. Las decisiones operativas y el progreso por sesión se registran en `docs/migration/evolution-api/PROGRESS.md`.
>
> **Fecha:** 2026-04-29
> **Autor del diseño:** Claude (Opus, sesión brainstorming)
> **Aprobado por:** Manuel (sesión 2026-04-29)
> **Implementación:** 5 sesiones Sonnet — `SESSION-EVO-04..08.md` en `docs/migration/evolution-api/prompts/`

---

## 1. Problema y motivación

El sistema de leads WhatsApp actualmente tiene Evolution API conectado en código (`lib/evolution.ts`, webhook, cron), pero la operación diaria de gestionar SIMs es manual y frágil:

- **QR onboarding** se hace desde el Evolution Manager UI público (`/manager/instance/.../dashboard`), que en v2.2.3 tiene un bug que renderiza el modal QR vacío. La API key del servidor queda expuesta en la URL pública.
- **Límite diario** está hardcoded a 200 msgs/sender en el cron. No se puede ajustar por SIM.
- **Contador diario** vive en `tabla configuracion` con clave `${instance}_primer_enviados_hoy` (string `count|date`). Hacky, no atómico, no consultable.
- **Rotación de senders** loopea por orden de `created_at`. Tiende a vaciar la primera SIM antes de pasar a la siguiente.
- **Sin UI** para visualizar capacidad restante por SIM ni del pool global.

**Impacto:** agregar una SIM nueva requiere `curl` + `INSERT SQL` + ajuste de env vars. Cambiar daily limit requiere editar código y redeploy. La distribución de mensajes no respeta el patrón "1 A, 1 B, 1 C, 2 A" que minimiza el riesgo de rate-limit por número.

---

## 2. Objetivos

### Funcionales
1. **Onboarding de SIM en menos de 60 segundos** desde la UI premium: input alias → click → QR → escaneo → conectada.
2. **Pool round-robin estricto:** 1 mensaje por tick, sender elegido por algoritmo LRU least-used.
3. **Daily limit por SIM** configurable desde la UI (default 15, editable, sin redeploy).
4. **Dashboard de capacidad** visible en `/senders` y en `/leads/nuevo`: cuántos mensajes restan hoy, por SIM y total.
5. **Auto-detección y recuperación** de SIMs desconectadas (badge rojo + botón "Reconectar").
6. **Adopción** transparente de instancias huérfanas que ya existen en Evolution pero no en la tabla.

### No-funcionales
- Cero exposición de API key del servidor en URLs o front-end.
- Race-safe: 5 crons defasados a 1 min sobre el mismo pool deben distribuir round-robin sin doble-uso.
- Reset diario idempotente (UPDATE atómico, no depende de quién tira primero).
- Soft delete por default (no rompe FK con `conversaciones.sender_id`).

### Out of scope (esta iteración)
- Migración a otro proveedor de WA. Sigue Evolution.
- A/B testing de copy del template de primer contacto. Sigue hardcoded.
- Auto-reconexión sin intervención humana cuando el QR caduca por sesión perdida (requeriría escaneo nuevo de QR — eso necesita humano físicamente con el celular).
- WebSocket / SSE para actualizar el dashboard en tiempo real. Polling cada 30s alcanza.

---

## 3. Arquitectura

### 3.1 Modelo de datos

```sql
-- Migración aplicada en SESSION-EVO-04
ALTER TABLE senders
  ADD COLUMN IF NOT EXISTS daily_limit INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS msgs_today INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reset_date DATE,
  ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS connected BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qr_requested_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_senders_pool_lookup
  ON senders (provider, activo, connected, msgs_today, last_sent_at)
  WHERE provider = 'evolution';
```

**Significado de campos nuevos:**

| Campo | Tipo | Sentido |
|---|---|---|
| `daily_limit` | int | Tope diario de envíos. Default 15. |
| `msgs_today` | int | Contador del día. Reset a 0 cuando `last_reset_date != today_AR`. |
| `last_reset_date` | date | Fecha del último reset (zona AR). |
| `last_sent_at` | timestamptz | Cuándo se mandó el último msg. Tiebreaker en LRU. |
| `connected` | bool | true si Evolution reportó `state=open` en el último check. |
| `connected_at` | timestamptz | Cuándo se conectó por última vez (post escaneo QR). |
| `qr_requested_at` | timestamptz | Cuándo se generó el último QR (para detectar caducidad >40s). |

**Backward-compat:** las claves viejas `${instance}_primer_enviados_hoy` en `tabla configuracion` se dejan como fallback de lectura en EVO-06, se borran en EVO-08.

### 3.2 Módulos backend

#### `apex-leads/src/lib/evolution-instance.ts` (nuevo, EVO-04)
Helpers para hablar con Evolution API. Aísla todas las URLs y headers en un solo archivo.

```typescript
export async function createInstance(name: string, webhookUrl: string): Promise<{ ok: boolean }>
export async function connectInstance(name: string): Promise<{ base64: string | null, code: string | null }>
export async function getInstanceState(name: string): Promise<'close' | 'connecting' | 'open' | 'unknown'>
export async function restartInstance(name: string): Promise<void>
export async function logoutInstance(name: string): Promise<void>
export async function deleteInstance(name: string): Promise<void>
export async function fetchAllInstances(): Promise<Array<{ name: string, state: string, phone: string | null }>>
export async function fetchPhoneNumber(name: string): Promise<string | null>
export async function setWebhook(name: string, webhookUrl: string, apikey: string): Promise<void>
```

#### `apex-leads/src/lib/sender-pool.ts` (nuevo, EVO-05)
Algoritmo de pool. Funciones puras sobre Supabase.

```typescript
// Devuelve el sender a usar en este tick. Null si pool agotado/sin SIMs disponibles.
export async function selectNextSender(supabase): Promise<SenderRow | null>

// UPDATE atómico: msgs_today += 1, last_sent_at = now(). Filtrado WHERE id=X AND msgs_today < daily_limit.
// Retorna false si la condición no se cumplió (race con otro cron) → caller debe reintentar selectNext.
export async function incrementMsgsToday(supabase, senderId: string): Promise<boolean>

// UPDATE bulk si last_reset_date != today_AR. Idempotente.
export async function resetDailyCountersIfNeeded(supabase): Promise<void>

// Lectura para UI. Devuelve resumen del pool.
export async function getCapacityStats(supabase): Promise<{
  total_today: number,
  used_today: number,
  remaining: number,
  per_sender: Array<{ id, alias, msgs_today, daily_limit, remaining, connected }>
}>

// Marca connected=false. Llamado tras N fallos consecutivos o al detectar state≠open.
export async function markDisconnected(supabase, senderId: string): Promise<void>
```

**Algoritmo de `selectNextSender`:**

```sql
-- Race-safe: la query es de lectura. El UPDATE atómico va separado en incrementMsgsToday.
SELECT * FROM senders
WHERE provider='evolution'
  AND activo=true
  AND connected=true
  AND msgs_today < daily_limit
ORDER BY msgs_today ASC, last_sent_at ASC NULLS FIRST
LIMIT 1;
```

Esto satisface el patrón "1 A → 1 B → 1 C → 2 A → ..." que pidió Manuel:
- Si todas en 0: tiebreak por `last_sent_at` → la primera se elige por orden de creación (NULLS FIRST).
- Después de mandar A: A.msgs_today=1, B y C en 0 → elige B.
- Después de B: A=1, B=1, C=0 → elige C.
- Después de C: todos en 1 → tiebreak por last_sent_at más viejo → A (que mandó hace ~2 min) → ciclo perfecto.

**Race condition:** si dos crons leen al mismo tiempo y ambos eligen A, el UPDATE atómico (`incrementMsgsToday`) protege:
```sql
UPDATE senders
SET msgs_today = msgs_today + 1, last_sent_at = NOW()
WHERE id = $1 AND msgs_today < daily_limit
RETURNING id;
```
Si `RETURNING` está vacío, el caller llama `selectNextSender` de nuevo.

### 3.3 API routes (apex-leads)

| Método | Path | EVO | Función |
|---|---|---|---|
| POST | `/api/senders` (modificado) | 04 | Crea fila + auto-crea instancia en Evolution + configura webhook |
| GET | `/api/senders/[id]/qr` | 04 | Llama Evolution `connect`, retorna `{base64, code}` |
| GET | `/api/senders/[id]/state` | 04 | Retorna `{state}` (close/connecting/open) |
| POST | `/api/senders/[id]/reconnect` | 04 | restart + connect |
| DELETE | `/api/senders/[id]` (modificado) | 04 | Soft delete (activo=false). `?hard=true` solo si no hay conversaciones |
| GET | `/api/senders/orphans` | 04 | Lista instancias en Evolution no presentes en tabla |
| POST | `/api/senders/adopt` | 04 | Importa una instancia huérfana como sender |
| GET | `/api/senders/capacity` | 07 | Devuelve `getCapacityStats(...)` para el dashboard |

### 3.4 Refactor del cron (EVO-06)

`apex-leads/src/app/api/cron/leads-pendientes/route.ts` cambia de:
```
for (sender of senders): mandar 1 lead → 1 envío por sender por tick
```
a:
```
1. resetDailyCountersIfNeeded()
2. sender = selectNextSender(); si null → return "pool_agotado"
3. Claim 1 lead disponible (lógica actual de claim atómico, intacta)
4. enviarMensajeEvolution(...) usando sender.instance_name
5. incrementMsgsToday(sender.id) — si false (race), goto 2
6. return ok
```

**5 crons defasados a 1 min** = 5 ticks/min = 5 msgs/min distribuidos round-robin perfecto entre SIMs disponibles.

Ventana horaria 7-21 ART y switch global `first_contact_activo` se mantienen.

### 3.5 Frontend

#### `/senders` (modificado en EVO-04 + EVO-07)

**Layout:**
```
┌─ Header ─────────────────────────────────────────────────┐
│ Senders                                  [+ Agregar SIM] │
│ Pool restante hoy: 23/30  ·  SIMs activas: 2/2 ●●        │
├─ Banda huérfanas (si hay) ───────────────────────────────┤
│ ⚠ 1 instancia detectada en Evolution sin sender en DB:   │
│   wa-sim01  [Adoptar como sender] [Borrar]               │
├─ Grilla de cards ────────────────────────────────────────┤
│ ┌─ SIM 01 ────────────┐  ┌─ Personal Pepe ──────┐         │
│ │ +5491XXX  ●conectada│  │ +5491YYY  ●desconect │         │
│ │ 8/15 msgs hoy [▓▓▓░]│  │ 0/15 msgs hoy [░░░░░] │         │
│ │ [Test][Editar][Pause]│  │ [Reconectar QR][Edit] │         │
│ └─────────────────────┘  └──────────────────────┘         │
└──────────────────────────────────────────────────────────┘
```

**Modal "Agregar SIM" (premium, 2 pantallas):**

Pantalla 1 (alias + límite):
```
┌─ Agregar SIM ────────────────────────────────┐
│ Alias        [SIM 01_______________]          │
│ Límite/día   [15 ▼]  (default 15)            │
│ Color        [● ● ● ● ● ● ● ●]                │
│                                               │
│ [Cancelar]                  [Conectar SIM →] │
└──────────────────────────────────────────────┘
```

Pantalla 2 (QR):
```
┌─ Conectá la SIM ─────────────────────────────┐
│  Abrí WhatsApp → Dispositivos vinculados →   │
│  Vincular dispositivo, y escaneá:            │
│                                               │
│            [   QR ANIMADO   ]                │
│                                               │
│  Caduca en 38s  [Regenerar QR]               │
│                                               │
│  Esperando conexión... ●●●                   │
└──────────────────────────────────────────────┘
```

Cuando `state=open` → animación de check verde + toast "✅ SIM conectada como +5491XXX" + cierra modal + refresh grilla.

#### `/leads/nuevo` stats bar (EVO-07)

Hoy: `[En cola] [Hoy enviados/fallidos] [Horario] [Sistema]` (4 cards).
Después: agregar 2 cards más:
- `[Pool restante hoy: N/M msgs]`
- `[SIMs activas: 2/2 ●●]`

Y debajo, mini-grid de progress bars por SIM:
```
SIM 01  ▓▓▓▓░░░░░░  4/15
SIM 02  ▓▓▓░░░░░░░  3/15
```

### 3.6 Mensaje de primer contacto (EVO-08)

Hoy en `apex-leads/src/app/api/cron/leads-pendientes/route.ts`:
```
Hola {nombre}
Vi que tu negocio tiene {rating}⭐ en Google Maps.
Hice este boceto para un negocio como el tuyo: {demoHost}
Trabajo con negocios de {zona} haciendo páginas web para {rubro} - conocé mi trabajo en {SITIO_PRINCIPAL_APEX}
¿Te lo armamos con tu marca?
```

Cambio: SIN agregar 💳 ni precio (Manuel decidió no incluirlo en el primer contacto). Si en algún momento quiere agregarlo, lo hacemos editando esa función — 1 sesión chica.

---

## 4. Decisiones cerradas

| # | Decisión | Razón |
|---|---|---|
| 1 | Cron + round-robin LRU (1 msg/tick) | Distribuye carga, evita rate-limit por número |
| 2 | Algoritmo: `ORDER BY msgs_today ASC, last_sent_at ASC NULLS FIRST` | Cumple el patrón 1A→1B→1C→2A pedido por Manuel |
| 3 | Onboarding QR premium automático (1 input: alias) | UX premium, cero fricción técnica |
| 4 | Adopción automática de `wa-sim01` | No perder la instancia ya creada |
| 5 | Mensaje hardcoded sin tarjetita 💳 | Manuel prefiere editarlo en código cuando lo necesite |
| 6 | Reset diario 00:00 ART, idempotente vía UPDATE bulk al inicio del tick | Alineado con ventana 7-21 ART; race-safe |
| 7 | Daily limit editable per-sender desde modal Add/Edit | Manuel necesita 15 default + 20 para una SIM |
| 8 | Sender disconnect: contador 10-fallos existente + badge UI + botón Reconectar | Aprovecha lógica que ya funciona |
| 9 | Soft delete por default | Preserva FK con `conversaciones.sender_id` |
| 10 | Dashboard capacidad en `/leads/nuevo` y `/senders` | Visibilidad donde Manuel ya trabaja |

---

## 5. Riesgos y mitigaciones

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Race condition entre 5 crons defasados a 1min | Media | UPDATE atómico de `msgs_today` con `WHERE msgs_today < daily_limit`. Caller reintenta `selectNextSender` si UPDATE devuelve 0 filas. |
| Evolution Manager v2.2.3 sigue con bug del modal QR | Cierta | Bypaseamos: nuestra UI usa `/api/senders/[id]/qr` que llama Evolution server-side. El Manager queda solo como fallback de diagnóstico. |
| `DATABASE_ENABLED=true` en Evolution Railway no se aplicó tras cambio | Alta | EVO-04 incluye check de smoke: si tras crear instancia no llega base64 en N intentos, log de warning con sugerencia de redeploy Railway. |
| Sesión de WhatsApp se cae mid-day (banneo, login en otro dispositivo) | Media | Cron marca `connected=false` tras 10 fallos. UI muestra badge rojo + botón Reconectar. No hay auto-recovery (requiere escaneo manual). |
| Pool agotado a mitad de la ventana 7-21 ART | Alta (pocas SIMs) | Cron retorna `pool_agotado`, no falla. Dashboard muestra 0/30 → Manuel sabe que tiene que esperar al próximo día o agregar SIMs. |
| Cron viejo (vacía-una-antes-de-la-siguiente) sigue corriendo durante deploy | Baja | EVO-06 reemplaza la función completa en un solo commit. Vercel deploy es atómico. |

---

## 6. Plan de implementación

5 sesiones independientes. Cada una deployable y reversible. Detalle por sesión en `docs/migration/evolution-api/prompts/SESSION-EVO-XX.md`.

| # | Sesión | Modelo | Estimado | Output |
|---|---|---|---|---|
| 04 | Schema + QR Onboarding Premium + Helpers | Sonnet | 60-90 min | Migración SQL aplicada, modal QR funcional, lib/evolution-instance.ts |
| 05 | Sender Pool LRU | Sonnet | 30-45 min | lib/sender-pool.ts + tests unit |
| 06 | Refactor Cron a 1-msg-per-tick | Sonnet | 45-60 min | cron/leads-pendientes reescrito + smoke 30 ticks |
| 07 | Dashboard Capacidad UI | Sonnet | 45-60 min | Stats extendidos en /senders y /leads/nuevo |
| 08 | Cleanup + Tests E2E | Sonnet | 30-45 min | Mensaje sin 💳, drop claves viejas, Playwright QR flow |

**Pre-requisito antes de EVO-04:** Manuel confirma que `DATABASE_ENABLED=true` en Railway está aplicado y redeployó (si no, EVO-04 lo cubre como Tarea 0).

---

## 7. Definición de éxito

El feature está listo cuando, partiendo de una sesión limpia:

1. Manuel hace click en "Agregar SIM" en `/senders`, escribe "SIM 03", elige límite 15, escanea el QR con un teléfono nuevo. En menos de 60s la SIM aparece conectada en la grilla.
2. Manuel mira el stats bar de `/leads/nuevo` y ve "Pool restante hoy: 45/45 msgs · SIMs activas: 3/3".
3. Manuel ejecuta 5 ticks del cron manualmente (`?force=true`). Verifica que los 5 mensajes se distribuyeron 2-2-1 entre SIM 01, 02, 03 (round-robin).
4. Manuel borra una SIM con soft delete. La grilla la oculta (filtra activo=true). Las conversaciones viejas mantienen su `sender_id`.
5. Manuel desconecta una SIM físicamente (cierra sesión en el celular). Tras 10 envíos fallidos, la UI muestra badge rojo y botón Reconectar. Click → modal QR aparece, escanea, vuelve a verde.
