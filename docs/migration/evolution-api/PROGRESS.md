# PROGRESS — Migración Twilio → Evolution API

> **Documento vivo.** Se actualiza al final de cada sesión.

---

## Estado actual

**Ultima sesion completada:** SESSION-EVO-07 (2026-04-29) — Dashboard de capacidad UI premium.
**Proxima sesion:** SESSION-EVO-08 — Cleanup, sin tarjetita, tests E2E (última de la serie)
**Siguiente prompt:** `docs/migration/evolution-api/prompts/SESSION-EVO-08.md`

> **Re-scope 2026-04-29:** El "big bang cutover" original (EVO-04 viejo, archivado) se reemplazó por un proyecto de 5 sesiones que entrega QR onboarding premium, pool round-robin LRU, dashboard de capacidad y cleanup. Spec doc canónico: [`docs/superpowers/specs/2026-04-29-evolution-pool-design.md`](../../superpowers/specs/2026-04-29-evolution-pool-design.md).
>
> **Pre-requisitos para EVO-04:** Manuel debe confirmar que `DATABASE_ENABLED=true` en Railway está aplicado y redeployado (cambio hecho 2026-04-29 21:12 ART, falta confirmar redeploy).

---

## Progreso por sesion

- [x] SESSION-EVO-01 (Sonnet) · Infra Railway — **HECHO MANUALMENTE por Manuel** (Evolution API en `https://evolution-api-production-3571.up.railway.app`, instancia `wa-sim01` creada sin escanear). Prompt original archivado en `prompts/_archived/`.
- [x] SESSION-EVO-02 (Sonnet) · Core lib `evolution.ts` + webhook route + Supabase schema — **COMPLETO** (2026-04-28)
- [x] SESSION-EVO-03 (Sonnet) · Callers + cleanup Twilio — **COMPLETO** (2026-04-28, combinado con EVO-02)
- [x] SESSION-EVO-04 (Sonnet) · Schema pool + QR onboarding premium + helpers — **COMPLETO** (2026-04-29)
- [x] SESSION-EVO-05 (Sonnet) · Sender pool LRU + tests round-robin — **COMPLETO** (2026-04-29)
- [x] SESSION-EVO-06 (Opus) · Refactor cron 1-msg-per-tick — **COMPLETO** (2026-04-29)
- [x] SESSION-EVO-07 (Opus) · Dashboard de capacidad UI premium — **COMPLETO** (2026-04-29)
- [ ] SESSION-EVO-08 (Sonnet) · Cleanup, sin tarjetita, tests E2E — pendiente

---

## Decisiones de diseno

### Scaffold (2026-04-28)

**Respuestas de Manuel a preguntas de diseno:**
- Migracion: reemplazar Twilio completamente por Evolution API.
- Hosting Evolution API: Railway (ya tiene plan).
- Estrategia: big bang — un corte limpio, sin dual-write.
- Tipo de cuenta WA: numeros regulares via QR scan (no Business API oficial de Meta).
- Instancias: N SIM cards (sin limite fijo). Arrancar con 2 SIMs disponibles hoy, agregar mas en cualquier momento sin tocar el codigo.
- Limite por instancia: pocos mensajes/dia por numero (definir en EVO-01). Configurable por fila en tabla `senders`.
- Plazo: produccion apenas el codigo este listo y la infra operativa.

**Simplificacion clave respecto al estado actual:**
- Con numeros regulares NO se necesitan templates de Meta. El primer contacto puede ser texto libre.
- Elimina: `TWILIO_CONTENT_SID`, Content API calls, `resolveWhatsAppDemoHost` (logica de demos para template). La logica de demos puede sobrevivir como helper para armar el texto del mensaje.
- El webhook de Evolution API es JSON (no form-urlencoded). No hay TwiML. Respuesta es 200 OK plano.
- Status de delivery llega en el mismo webhook (evento `messages.update`), no en endpoint separado.

### SESSION-EVO-02 + EVO-03 (2026-04-28)

**Lo que se hizo:**
- `apex-leads/src/lib/evolution.ts` creado — `enviarMensajeEvolution(telefono, texto, instanceName)`, `getEvolutionConfig()`, manejo de bloqueos via `isTelefonoHardBlocked`.
- `apex-leads/src/app/api/webhook/evolution/route.ts` creado — reemplazo completo de `twilio/route.ts`. Extrae phone de `remoteJid`, ignora `fromMe: true` y grupos `@g.us`, lookup de sender por `instance_name`, maneja `messages.update` para errores de delivery inline.
- `apex-leads/supabase-migration-evolution-api.sql` creado — `ALTER TABLE senders ADD COLUMN IF NOT EXISTS instance_name TEXT` + índice.
- `cron/leads-pendientes/route.ts` reescrito — senders dinámicos desde DB, primer contacto texto libre (sin template).
- `cron/followup/route.ts` actualizado — usa `enviarMensajeEvolution` + `instance_name`.
- `agente/enviar/route.ts` actualizado — usa `enviarMensajeEvolution` + `instance_name`.
- `senders/[id]/test/route.ts` actualizado — usa `enviarMensajeEvolution` + `instance_name`.
- `agente/diagnostico/route.ts` actualizado — variables Evolution API en lugar de Twilio.
- `conversaciones/media/route.ts` actualizado — proxy Evolution API con `apikey`, retorna 410 para URLs Twilio legacy.
- Archivos eliminados: `lib/twilio.ts`, `webhook/twilio/route.ts`, `webhook/twilio-status/route.ts`.
- `tsc --noEmit` verificado — cero errores nuevos (todos los errores pre-existentes de worktree sin `node_modules`).

### SESSION-EVO-04 (2026-04-29)

**Lo que se hizo:**
- Migración SQL aplicada vía MCP Supabase (project `hpbxscfbnhspeckdmkvu`, name `evolution_pool_session_evo_04`):
  - CHECK constraint de `senders.provider` actualizado para permitir `'evolution'` (antes solo `'twilio'`/`'wassenger'` — esto **no estaba en el plan original** y bloqueaba todos los inserts).
  - 7 columnas nuevas: `daily_limit` (default 15), `msgs_today` (default 0), `last_reset_date`, `last_sent_at`, `connected` (default false), `connected_at`, `qr_requested_at`.
  - Índice parcial `idx_senders_pool_lookup` para `selectNextSender` LRU.
- `apex-leads/supabase-migration-evolution-pool.sql` guardado como registro local de la migración.
- `apex-leads/src/lib/evolution-instance.ts` creado con helpers: `createInstance`, `connectInstance`, `getInstanceState`, `restartInstance`, `logoutInstance`, `deleteInstance`, `fetchAllInstances`, `fetchPhoneNumber`, `setWebhook`, `buildWebhookUrl`, `slugifyAlias`. Maneja ambos formatos de respuesta del QR (`{ base64, code }` y `{ qrcode: { base64, code } }`).
- 5 API routes nuevos:
  - `GET /api/senders/[id]/qr` — connect + reintento con restart si llega `count:0` sin base64.
  - `GET /api/senders/[id]/state` — connectionState; auto-marca `connected=true` y completa `phone_number` si llega `open`.
  - `POST /api/senders/[id]/reconnect` — restart + connect; baja `connected=false` y marca `qr_requested_at`.
  - `GET /api/senders/orphans` — cruza `fetchAllInstances` con DB. `DELETE ?name=` para purgar instancias huérfanas.
  - `POST /api/senders/adopt` — importa una instancia huérfana como sender + reconfigura webhook.
- `POST /api/senders` modificado — provider 'evolution' por default, autoslugifica alias → `wa-...`, autocrea la instancia en Evolution con webhook configurado, hace cleanup best-effort si falla el insert.
- `DELETE /api/senders` modificado — soft por default (`activo=false`); `?hard=true` solo si no hay convs/leads referenciando el sender, y borra la instancia en Evolution si era 'evolution'.
- `PATCH /api/senders` modificado — whitelist de campos editables incluye `daily_limit`.
- UI premium en `apex-leads/src/app/senders/page.tsx`:
  - Stats header con pool restante hoy (`totalDaily - usedDaily`) y SIMs conectadas.
  - Banda amarilla de huérfanas con botones Adoptar / Borrar.
  - Modal Add 2 pantallas — pantalla 1 (alias + límite + color) → POST `/api/senders` → pantalla 2 (`<QRConnectModal>`).
  - `<QRConnectModal>` reutilizable: trae QR vía API, countdown 40s, botón Regenerar al caducar, polling de `/state` cada 2s, animación check verde + toast cuando llega `open`.
  - Cards de senders Evolution con badge `connected` / `disconnected`, instance_name, barra `msgs hoy: X/Y`, botón "Reconectar QR" cuando está disconnected.
  - Modal Edit ahora soporta `daily_limit` para senders Evolution.
  - Toast bottom-right para feedback de adopción/reconexión.
- `tsc --noEmit` exit 0 (limpio).
- **Smoke físico (escaneo QR con celular) queda para Manuel** — código y endpoints listos, falta confirmar el round-trip completo abriendo `/senders` localmente o en producción.

**Decisión no en el plan:** se agregó `'evolution'` al CHECK de `provider` en la migración. El plan asumía que ya existía pero la DB seguía con `['twilio','wassenger']`.

### SESSION-EVO-06 (2026-04-29)

**Lo que se hizo:**
- `apex-leads/src/app/api/cron/leads-pendientes/route.ts` reescrito: pasa de N-msgs-por-tick (loop por sender) a 1-msg-por-tick con round-robin LRU. Estructura nueva:
  - `procesarUnTick(sup, forced)` — orquesta: `resetDailyCountersIfNeeded` → check switch global y ventana → loop con hasta 3 reintentos sobre `selectNextSender` → `claimYEnviarLead`. Devuelve `pool_agotado` si no hay sender disponible y `race_pool_max_reintentos` si la concurrencia tira el sender 3 veces seguidas.
  - `claimYEnviarLead(sup, sender)` — claim atómico de un lead pendiente con misma lógica que el viejo (verif WA, bloqueo hard, dedupe `yaConv`/`yaLead`/`yaConvPorLead`, lock `procesando_hasta`). Tras envío exitoso a Evolution: `incrementMsgsToday` (race tras envío = solo log, sin rollback porque el msg ya está), `INSERT` en `conversaciones`, `UPDATE` lead a `contactado`, reset `_primer_fallos` del sender. Tras error: incrementa `_primer_fallos`; al llegar a 10 llama a `markDisconnected` (no desactiva — Manuel reconecta desde UI).
- Imports nuevos desde `lib/sender-pool`: `selectNextSender`, `incrementMsgsToday`, `resetDailyCountersIfNeeded`, `markDisconnected`, `PoolSender`.
- `maxDuration` bajado de 60 → 30 (1 envío por tick).
- Helpers viejos `leerDailyCount`/`incrementarDailyCount`/`escribirConfig` mantenidos como `*Deprecated` (rollback fallback hasta EVO-08), suprimidos con `void` para evitar warnings de unused.
- `procesarSender` (loop viejo de N-msgs-por-tick) eliminado — el nuevo handler no lo usa y mantenerlo como dead-code confunde más de lo que ayuda; rollback es vía `git revert`.
- `tsc --noEmit` exit 0. 147/147 tests del repo verdes (sin tests nuevos — el smoke E2E del cron queda para EVO-08).

**Diferencias respecto al plan:**
- Se borró `procesarSender` (~240 líneas) en lugar de dejarlo deprecated. Razón: `git revert` provee el mismo rollback sin contaminar el archivo activo.
- Se mantuvieron como deprecated solo los 3 helpers que el plan pidió explícitamente (`leerDailyCount`, `incrementarDailyCount`, `escribirConfig`).

**Pendiente humano:**
- Smoke 6-tick (curl `?force=true` × 6 con dev server) — Manuel lo corre cuando tenga 2+ SIMs conectadas y leads en cola. Verificar distribución round-robin ~3/3 en `senders.msgs_today`.

### SESSION-EVO-07 (2026-04-29)

**Lo que se hizo:**
- `apex-leads/src/app/api/senders/capacity/route.ts` creado — endpoint público read-only que devuelve `getCapacityStats(supabase)`. Sin auth (no expone API keys), `dynamic = 'force-dynamic'` para evitar cacheo de Vercel. Devuelve 500 con mensaje en caso de error.
- `apex-leads/src/app/leads/nuevo/NuevoLeadClient.tsx`:
  - Tipos `CapacitySender` y `CapacityStats` agregados.
  - State `capacity` + función `cargarCapacity()` con polling cada 30s en paralelo a `cargarStats()`.
  - Nuevo bloque "Capacidad del pool de SIMs" después del stats bar de cola con 2 cards: **Pool restante** (con barra de progreso lime) y **SIMs activas** (con dot-grid coloreado por estado de conexión).
  - Nuevo bloque "Capacidad por SIM" debajo: mini-grid con barra `msgs_today/daily_limit` por sender, color del sender, opacidad reducida y label "desconectada" cuando aplica.
- `apex-leads/src/app/senders/page.tsx`:
  - Tipos `CapacitySender` y `CapacityStats` agregados.
  - State `capacity` + fetch a `/api/senders/capacity` integrado en `cargar()` (paralelo a `senders` y `orphans`); polling cada 30s para mantener stats vivos.
  - Subtítulo del header simplificado a "Pool de SIMs WhatsApp"; el strip de stats text-based (`Pool restante hoy: X/Y · SIMs conectadas: ...`) se reemplazó por una card horizontal que muestra `Pool hoy: usado/total (restantes)` + `SIMs: connected/total` con dot-grid por SIM, divisor vertical entre ambos grupos.
  - Cards de senders Evolution: la barra `msgs_today/daily_limit` ahora pinta **ámbar** (`#f59e0b`) cuando `used >= limit` (antes pintaba rojo solo a `pct === 100`), el número de mensajes pinta lime mientras hay cupo y ámbar al alcanzar el límite, y aparece un texto "Límite diario alcanzado" cuando aplica. Eliminadas variables locales `totalDaily`/`usedDaily`/`connectedCount` (ahora vienen del endpoint).
- Polling de capacity: 30s en ambas pantallas. La `cargarStats()` de `/leads/nuevo` mantiene su frecuencia (sigue compartiendo el mismo intervalo).
- `tsc --noEmit` exit 0. 147/147 tests verdes (sin tests nuevos — endpoint thin wrapper sobre `getCapacityStats` ya cubierto por `__tests__/sender-pool.test.ts`).

**Diferencias respecto al plan:**
- Plan dijo "extender el stats bar (después del bloque queueStats)" con `grid-cols-2 md:grid-cols-4` reusando 2 cards existentes. En la práctica las 4 cards de queueStats (En cola / Hoy / Horario / Sistema) son ortogonales a las 2 nuevas (Pool / SIMs), así que el bloque nuevo es independiente con `grid-cols-1 md:grid-cols-2` para mantener proporción visual.
- Plan dijo trabajar sobre `main`. Repo está en `master` (Manuel: no usa feature branches). Commit en `master`.
- Plan dijo "agregar header con stats" en `/senders`; ese header ya existía pero text-based con backticks de `senders` array. Reemplazado por la card horizontal nueva que tira de `/api/senders/capacity` (consistente con `/leads/nuevo` y diferencia "total" en sólo SIMs conectadas).

**Pendiente humano:**
- Smoke visual con `npm run dev`: `/senders` y `/leads/nuevo` con SIMs conectadas y leads encolados. Verificar polling 30s en Network tab y comportamiento ámbar al alcanzar límite diario.

### SESSION-EVO-05 (2026-04-29)

**Lo que se hizo:**
- `apex-leads/src/lib/sender-pool.ts` creado — funciones puras sobre Supabase, sin estado interno:
  - `selectNextSender(supabase)` — query LRU `ORDER BY msgs_today ASC, last_sent_at ASC NULLS FIRST LIMIT 1`. Filtra `msgs_today < daily_limit` en JS porque PostgREST no soporta comparaciones columna-columna; el orden se aplica en SQL y se confirma en JS para tener resultados estables aunque el mock ignore `.order()`.
  - `incrementMsgsToday(supabase, senderId)` — UPDATE atómico con optimistic concurrency: lee `msgs_today` actual, hace UPDATE filtrado por `eq('msgs_today', current)` para que solo gane uno entre crons concurrentes. Devuelve `false` si la fila no fue actualizada (race, sender al límite, desconectado o inactivo).
  - `resetDailyCountersIfNeeded(supabase)` — UPDATE bulk con `.or('last_reset_date.is.null,last_reset_date.lt.{today_AR}')`. Idempotente.
  - `getCapacityStats(supabase)` — una query a `senders WHERE provider='evolution' AND activo=true ORDER BY created_at`, agregaciones en JS. Devuelve `{ total_today, used_today, remaining, active_connected, active_total, per_sender[] }`.
  - `markDisconnected(supabase, senderId)` — UPDATE `connected=false`. Llamado por EVO-06 tras 10 fallos.
  - `todayInArgentina(date?)` exportado — helper público para sincronizar reset/UI con la zona AR vía `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })`.
- `apex-leads/src/lib/evolution.ts` re-exporta `PoolSender` para que el cron en EVO-06 importe del módulo de transporte sin tirar de `sender-pool.ts` directamente (evita imports cíclicos).
- Tests unitarios (`apex-leads/__tests__/sender-pool.test.ts`, 23 casos): cubren `selectNextSender` (vacío/al-límite/menor-msgs-today/empate-LRU/NULLS-FIRST/error), `incrementMsgsToday` (disponible/al-límite/no-existe/disconnected/inactivo/race), `resetDailyCountersIfNeeded` (call shape, idempotencia, error), `getCapacityStats` (suma, exclusión de disconnected, lista vacía, no-negativo), `markDisconnected` (call shape, error), `todayInArgentina` (shape, frontera UTC→AR).
- Smoke round-robin (`apex-leads/__tests__/sender-pool-roundrobin.test.ts`, 3 casos): mock Supabase in-memory backed por array mutable. 30 ticks con 3 SIMs (15/15/20) reparten 10/10/10. Cuando una SIM se desconecta a los 9 ticks, las otras dos absorben sin saltar turnos. Pool agotado retorna null.
- Total: 26/26 tests del pool verdes, 147/147 tests del repo verdes, `tsc --noEmit` exit 0.

**Decisiones técnicas no en el plan original:**
- En lugar de `WHERE msgs_today < daily_limit` en SQL puro (no soportado por PostgREST), se hace optimistic concurrency en `incrementMsgsToday` con `eq('msgs_today', currentValue)`. Race-safe equivalente al UPDATE atómico del plan.
- `last_sent_at` en el round-robin test se sustituye al apply-time del UPDATE en el mock para tener orden monotónico determinista sin mockear el global `Date` (que provocaba recursión infinita).
- Re-orden defensivo en JS dentro de `selectNextSender` después del SQL `ORDER BY` — barato (n<10) y blindea contra mocks que ignoran `.order()`.

---

## Inventario tecnico (pre-migracion)

### Archivos que usan Twilio hoy
- [x] `apex-leads/src/lib/twilio.ts` — ELIMINADO
- [x] `apex-leads/src/app/api/webhook/twilio/route.ts` — ELIMINADO
- [x] `apex-leads/src/app/api/webhook/twilio-status/route.ts` — ELIMINADO
- [x] `apex-leads/src/app/api/cron/leads-pendientes/route.ts` — MIGRADO
- [x] `apex-leads/src/app/api/cron/followup/route.ts` — MIGRADO
- [x] `apex-leads/src/app/api/senders/[id]/test/route.ts` — MIGRADO
- [x] `apex-leads/src/app/api/agente/enviar/route.ts` — MIGRADO
- [x] `apex-leads/src/app/api/agente/diagnostico/route.ts` — MIGRADO
- [x] `apex-leads/src/app/api/conversaciones/media/route.ts` — MIGRADO

### Env vars Twilio actuales (Vercel) — a ELIMINAR en EVO-04
```
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_WHATSAPP_NUMBER
TWILIO_ACCOUNT_SID_2
TWILIO_AUTH_TOKEN_2
TWILIO_WHATSAPP_NUMBER_2
```

### Env vars Evolution API a agregar (Vercel, en SESSION-EVO-04)
```
EVOLUTION_API_URL=https://evolution-api-production.up.railway.app
EVOLUTION_API_KEY=<secret>
```

### Supabase (project hpbxscfbnhspeckdmkvu)
- Tabla `senders` — agregar `instance_name` ejecutando `apex-leads/supabase-migration-evolution-api.sql`.
- Insertar filas de SIM cards con `provider='evolution'`, `instance_name='sim01'`, etc.

---

## Bloqueos / pendientes humanos

- **✅ RESUELTO 2026-04-29 22:51 ART: Railway healthy.** Diagnóstico completo: la imagen `atendai/evolution-api:latest` está abandonada desde feb 2025 (clavada en v2.2.3 con Baileys `2,3000,1015901307` que WhatsApp ya no acepta — handshake fallaba silencioso, nunca generaba QR). Solución aplicada: cambio de imagen Docker en Railway de `atendai/evolution-api:latest` a `evoapicloud/evolution-api:v2.3.7` (repo oficial, última estable de dic 2025). QR ahora se genera al primer intento. Instancia `wa-sim01` queda en Railway huérfana (sin escanear) lista para que EVO-04 la adopte desde la UI premium.
- **Estado tabla `senders` (verificado vía MCP 2026-04-29):** 4 senders todos `provider='twilio'`, ninguno con `instance_name`. El cron Evolution no está enviando nada (filtra `provider='evolution'`). Cuando EVO-04 adopte `wa-sim01`, será el primer sender Evolution real.
- **Limpieza Twilio aplicada 2026-04-29 22:42 ART (vía MCP):**
  - `new apex` → DELETE (sin convs/leads).
  - `APEX` (1060 convs, 42 leads) → `activo=false` (FK preservada).
  - `APEX 2` (2570 convs, 82 leads) → `activo=false` (FK preservada).
  - `Assistify Respaldo` (653 convs) → `activo=false` (estaba activo, ya no).
  - Si en algún momento Manuel quiere hard-delete de los 3 inactivos: requiere primero `UPDATE conversaciones SET sender_id=NULL WHERE sender_id IN (...)` y `UPDATE leads SET sender_id=NULL WHERE sender_id IN (...)`. NO urgente.
- Manuel tiene 2 SIM cards disponibles. Conectar via QR en SESSION-EVO-04 (ahora desde la UI premium nueva, no manualmente).
- `daily_limit` por sender se decide al agregar cada SIM en la UI (default 15, Manuel pondrá 20 a una específica).
- Ejecutar `supabase-migration-evolution-api.sql` (la vieja, EVO-02) ya estaba; la nueva `supabase-migration-evolution-pool.sql` se ejecuta dentro de SESSION-EVO-04 vía MCP Supabase.

## Decisiones de diseño SESSION-EVO-04..08 (re-scope 2026-04-29)

Resumen alto nivel — detalle completo en el spec doc.

| # | Decisión | Razón |
|---|---|---|
| 1 | Cron + round-robin LRU (1 msg/tick) | Distribuye carga, evita rate-limit por número. |
| 2 | Algoritmo: `ORDER BY msgs_today ASC, last_sent_at ASC NULLS FIRST` | Cumple el patrón 1A→1B→1C→2A. |
| 3 | Onboarding QR premium automático (1 input: alias) | UX premium, cero fricción técnica. |
| 4 | Adopción automática de `wa-sim01` | No perder la instancia ya creada. |
| 5 | Mensaje hardcoded sin tarjetita 💳 | Manuel prefiere editar en código cuando quiera cambiar. |
| 6 | Reset diario 00:00 ART, idempotente | Alineado con ventana 7-21 ART. |
| 7 | Daily limit editable per-sender desde modal | 15 default + 20 para una SIM específica. |
| 8 | Sender disconnect: 10-fallos + badge UI + Reconectar | Aprovecha lógica que ya funciona. |
| 9 | Soft delete por default | Preserva FK con conversaciones.sender_id. |
| 10 | Dashboard capacidad en `/leads/nuevo` y `/senders` | Visibilidad donde Manuel ya trabaja. |

---

## URLs y referencias

- Evolution API Railway: _pendiente SESSION-EVO-01_
- Webhook Vercel nuevo (Evolution): `https://leads.theapexweb.com/api/webhook/evolution`
- Supabase project: `hpbxscfbnhspeckdmkvu`
- Evolution API docs: https://doc.evolution-api.com
