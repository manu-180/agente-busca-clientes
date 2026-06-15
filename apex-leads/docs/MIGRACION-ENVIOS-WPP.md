# Migración del sistema de envío de WhatsApp — Plan y diagnóstico

> **Fuente de verdad.** Estado al 2026-06-15. Reconstruir TODO desde este archivo, no desde el chat.
> Fase actual: **Fase 1 (runtime) + Fase 2 🔴 integradas y verdes (tsc 0, jest 293/293, code-review OK, `next build` OK). Migración APLICADA a prod. Commiteado en rama `feat/sender-lifecycle-antiban` (2c59c17). SIN deploy todavía.** Ver §Estado de implementación (sesión 2) al final.

## Objetivo

Robustecer el envío de WhatsApp en frío (cold outreach a leads de Google Places) para que sea
**robusto ("que ya quede") pero barato**. Manuel manda primer contacto a comercios scrapeados.

## Contexto estratégico (decidido)

- **Caso de uso:** primer contacto en frío, masivo. Volumen objetivo **1.000–5.000/mes** (arrancar apuntando a ~1.000–2.000/mes).
- **Twilio (probado):** funcionaba pero caro. El template de marketing en Argentina = **$0.0618/msg** — ese costo es de **Meta**, no de Twilio. Cambiar de BSP NO lo baja (360dialog/Cloud API directo cobran el mismo fee de Meta + ahorran solo el markup). A 5.000/mes = ~$300/mes. Inviable para él.
- **Evolution API (actual):** gratis por mensaje pero los números se banean. Es la física del cold outreach, no un bug.
- **Inbound flip (descartado):** hacer que el lead escriba primero (ventana de servicio gratis) NO aplica — es 100% outbound desde listas scrapeadas.
- **Decisión:** seguir **no-oficial (Evolution) pero robustecido** — pool + failover + **reposición automática** + anti-ban. Dejar una **capa de abstracción** para meter API oficial en leads de alto valor más adelante.
- **Números:** Manuel usa **chips/SIMs reales** (mejor durabilidad que virtuales). Acepta el alta manual del OTP.

## Diagnóstico con datos (pool real al 2026-06-15)

DB Supabase `hpbxscfbnhspeckdmkvu`, tabla `senders`. 18 senders totales:

- **Hoy hay UN solo número vivo** (`activo=true AND connected=true`): *"Manu celu actual"* (limit 25/día).
  Capacidad real ≈ **25 msgs/día** (~750/mes), 5–7× por debajo del piso objetivo.
- **Se quema ~1 chip cada 2–3 días.** `device_removed` en 02, 03, 13, 14, 14 de junio. `device_removed` y `code_403` = **WhatsApp baneando el número**. **8 de 15 Evolution muertos así.**
- **EL BUG REAL: no hay reposición.** El failover saltea los muertos (bien), pero cuando un número muere queda **zombie** (`activo=true, connected=false`) y *nadie mete uno nuevo*. El pool se vació solo hasta 1. Encima el health-check intenta revivir cadáveres cada 8 min para siempre (gasta Railway).
- 3 senders `provider='twilio'` (APEX, APEX 2, Assistify Respaldo): legacy sin uso.
- 3 Evolution `connected=true` pero `activo=false` (Manu wpp business, Cami, Juli …258): vivos pero apagados a mano — recuperables si los chips son buenos.
- **Decisión de Manuel: descartar los 18 viejos y arrancar limpio.**

## Dónde corre todo

- **Evolution (sesiones Baileys):** Railway → `https://evolution-api-production-3571.up.railway.app` (env `EVOLUTION_API_URL`).
- **Panel + crons:** Vercel, plan **hobby**, dominio `https://leads.theapexweb.com` (env `NEXT_PUBLIC_APP_URL`).
- **DB:** Supabase `hpbxscfbnhspeckdmkvu`. **No** está en los MCP de Supabase conectados (el genérico no tiene permiso). Acceso vía REST con `SUPABASE_SERVICE_ROLE_KEY` de `apex-leads/.env.local`.
- **Sidecar Instagram:** FastAPI en Railway (proceso persistente, candidato para mover el loop de envío).
- **Monorepo:** `apex_hunter/` → `apex-leads/` (Next.js, envío WhatsApp) + `sidecar/` (FastAPI, Instagram).

## Mapa de código (archivos clave)

- `apex-leads/src/lib/evolution.ts` — `enviarMensajeEvolution()` (envío HTTP, pre-flight, retry, errores `EVO_ERR`). Endpoint `POST {url}/message/sendText/{instance}` body `{number, text}`. **NO hay delay/jitter entre mensajes.**
- `apex-leads/src/lib/sender-pool.ts` — pool round-robin LRU race-safe: `selectNextSender` (filtra `provider='evolution' AND activo AND connected AND msgs_today<daily_limit`), `incrementMsgsToday`, `markDisconnected/markConnected`, `incrementSendFailures`, `resetDailyCountersIfNeeded`, `getCapacityStats`.
- `apex-leads/src/lib/evolution-instance.ts` — `createInstance`, `connectInstance` (devuelve **QR base64 + pairing code**), `getInstanceState`, `restartInstance`, `logoutInstance`, `deleteInstance`, `fetchAllInstances`, `slugifyAlias`.
- `apex-leads/src/app/api/cron/leads-pendientes/route.ts` — cron de primer contacto (~650 líneas): selección de sender, envío, health-check inline (cada 3 min), auto-restart (>8 min caído), detección de outage.
- `apex-leads/src/app/api/webhook/evolution/route.ts` — webhook `CONNECTION_UPDATE` / `MESSAGES_UPSERT` (acá llega el `device_removed`/logout).
- `apex-leads/src/app/senders/page.tsx` + `app/api/senders/[id]/qr|reconnect/route.ts` — UI/flujo de alta y QR.
- Tabla `senders` columnas: id, alias, instance_name, phone_number, provider, color, daily_limit, msgs_today, last_sent_at, last_reset_date, connected, connected_at, disconnected_at, disconnection_reason, consecutive_send_failures, health_checked_at, activo, created_at.

## Plan por fases (en orden de impacto)

### Fase 0 — Limpiar el pool
Archivar/retirar los 18 senders viejos (Manuel los descarta). Marcar estado terminal; opcional `logoutInstance`/`deleteInstance` en Evolution para liberar Railway. No romper FKs con `conversaciones`.

### Fase 1 — Frenar el sangrado + reponer solo (PRIORIDAD)
- Estados de sender: `reserve` | `warming` | `active` | `banned` (probablemente columna `status` nueva, o derivar de flags existentes).
- Detectar baneo: `disconnection_reason IN (device_removed, code_403)` o reconexión fallida tras N intentos → marcar `banned`, sacar del pool, **dejar de intentar revivir**.
- **Promoción automática:** al banear un activo, promover un `reserve`/`warming` listo → mantener N vivos.
- **Alerta** a Manuel (WhatsApp a sí mismo / email / panel) cuando un chip cae por baneo → sabe que tiene que reponer.

### Fase 2 — Anti-ban (atacar la causa de la quema)

**Principio rector:** WhatsApp banea sobre todo por **reportes/bloqueos de usuarios**, no por volumen puro.
La palanca #1 es mensaje + targeting (bajar reportes), no los trucos técnicos. Meta realista: pasar de
"1 chip cada 2-3 días" a "un chip dura semanas/meses". Cero baneos es imposible en frío.

**🔴 Alto impacto (bajar reportes):**
- **Sin link en el primer mensaje.** Mandar el link de Carta recién cuando responden. Links en frío → spam-detection + reportes.
- **Targeting:** mandar solo a comercios SIN web (`websiteUri` vacío en Google Places). Menos irrelevancia = menos reportes.
- **Mensaje no-plantilla:** corto, con nombre del negocio + algo específico, tono humano.
- **Opt-out fácil** ("avisame y no te escribo más") → la gente responde en vez de reportar.
- **Cerrar con pregunta** → conversación bidireccional = señal positiva fuerte + lead caliente.

**🟡 Impacto medio (parecer humano):**
- **Delays con jitter** (60–180s aleatorio) entre envíos. Hoy mandan sin pausa → acelera baneo.
- **Warming ramp:** chip nuevo arranca en ~5–10/día y sube gradual en 2–3 semanas. Hoy `daily_limit` fijo hasta 30.
- **Ventana horaria humana** (9–13, 15–20, hábiles) con variación. Volumen conservador maduro: 20–40/día.
- **Peer warming** (módulo nuevo): conversaciones sintéticas entre los propios números, timing humano,
  emojis, "escribiendo", visto. Sobre todo en los primeros 7–14 días de un número nuevo.
  ⚠️ No como cluster cerrado (detectable): complementar con que reciban de números viejos / gente real.
- **Spintax** (cada mensaje algo distinto). **Perfil Business completo** (foto, nombre, descripción). **Reciprocidad** (que reciban y respondan, no solo emitan).

**🟢 Avanzado:**
- **Detección de shadowban:** medir ratio de entrega vía `MESSAGES_UPDATE` (ack). Mensajes que quedan en
  1 check ✓ (no ✓✓) = no entregados → retirar el número antes de gastar leads. Señal temprana de quema.
- **Diversidad de IP:** proxy por instancia (hoy todos salen por la misma IP de Railway = señal de granja).
- Días de descanso aleatorios por número. Nunca reusar números quemados. Dominio propio en links (carta.it.com).

**Decisión arquitectónica:** los delays largos NO entran en cron de Vercel (hobby, timeout). Mover el loop de
envío (y el peer-warming) a un **worker persistente en Railway** (el sidecar FastAPI ya es uno, o el server Evolution).

### Fase 3 — Onboarding asistido de chips
Flujo: panel "Agregar número" → `createInstance` + `connectInstance` (QR o pairing code) → escanear desde el teléfono → entra como `reserve` → warming automático. Reduce el trabajo manual a: registrar WhatsApp (OTP en el teléfono) + escanear 1 QR.

### Fase 4 — Capa de abstracción (futuro)
`lib/messaging/` con interfaz común `sendMessage(sender, telefono, texto)` que despacha por `provider`. Habilita meter API oficial (Cloud API) para leads de alto valor sin tocar el cron. La tabla `senders.provider` ya soporta `'evolution'|'twilio'|'wassenger'`.

## Gotchas (no perder)

- **OTP por SMS = manual.** Con chips reales el sistema NO captura el PIN. Es paso físico en el teléfono (~1 min/chip). Automatizarlo obligaría a números virtuales (se queman más) o gateway SMS hardware.
- **Reconexión ~14 días.** WhatsApp desvincula dispositivos si el teléfono principal no aparece cada ~14 días. El "buffer de reserva" NO son chips en un cajón: son chips **vinculados con su teléfono prendido**. Práctico: 2–3 teléfonos físicos prendidos. Menos quema (Fase 2) = menos teléfonos.
- **Vercel hobby:** crons limitados; no aguantan delays largos → de ahí el worker en Railway (Fase 2).
- **PostgREST sin agregados:** `select=col,count()` da 400 en esta instancia. Para stats, traer filas y agregar en cliente o crear RPC.
- **Seguridad:** `apex-leads/.env.local` tiene secretos en claro (ANTHROPIC_API_KEY, service_role, Google Places keys, CRON_SECRET, Wassenger, Evolution key). Verificar que esté en `.gitignore`. Considerar rotar si hubo exposición.

## Inputs del usuario (resueltos)

- Volumen: 1.000–5.000/mes (arrancar ~1.000–2.000).
- Origen leads: Google Places (100% outbound frío).
- Prioridad: equilibrio con foco en barato; recuperación automática real.
- Números: chips reales, puede comprar más, activarlos y registrarlos (OTP manual). Descarta los 18 viejos.

## Precios WhatsApp de referencia (Argentina, 2025-2026)

- Marketing template: **$0.0618/msg** (siempre se cobra). Utility: **$0.026** (gratis dentro de ventana de servicio 24h). Auth: $0.026.
- Cambio jul-2025: per-message pricing. 360dialog: ~€49/mes flat sin markup sobre fees de Meta.

## Estado de implementación (sesión 1 — 2026-06-15)

**Fase 1 (código): COMPLETA y VERDE.** `npx tsc --noEmit` = 0 · `npx jest` = 278/278 passed. SIN commit, SIN deploy, migración SIN aplicar.

Hecho:
- `supabase/migrations/20260615130000_sender-lifecycle.sql` — agrega `status` (reserve|warming|active|banned|archived, default 'active'), `warmup_started_at`, `daily_limit_target` (def 30), `banned_at`, `ban_reason` + backfill conservador (protege "Manu celu actual": orden banned→active→archived; twilio/wassenger→archived) + índice `senders_lifecycle_idx`.
- `src/lib/sender-lifecycle.ts` (módulo nuevo, funciones puras race-safe): `BAN_REASONS`, `classifyDisconnection`, `warmingDailyLimit` (ramp 5→10→15→20→25→target por días), `isWarmupComplete`, `markBanned`, `promoteFromReserve`, `tickWarming`.
- `src/lib/__tests__/sender-lifecycle.test.ts` — 32 tests.
- `src/app/api/cron/leads-pendientes/route.ts` — **optimización Vercel**: el health-check inline (~línea 484) excluye `status IN (banned,archived)` → deja de revivir cadáveres cada tick (ahorra tiempo de función + llamadas a Evolution).

⚠️ **GOTCHA DE DEPLOY (crítico): aplicar la migración ANTES de deployar el código.** El cron ya referencia `status`. Si se deploya sin la migración, la query del health-check da error → `senders=null` → health-check queda inactivo (degrada, NO crashea) hasta aplicar la migración. Orden correcto: 1) aplicar migración en el SQL Editor de Supabase, 2) verificar backfill (Manu celu actual=`active`; muertos device_removed/code_403=`banned`), 3) commit + deploy.

**Falta para sesión 2 (integración runtime + Fase 2):**
1. **Aplicar migración** a `hpbxscfbnhspeckdmkvu` (SQL Editor del dashboard; no hay MCP/CLI con acceso).
2. **Enganchar `markBanned` + `promoteFromReserve`** donde hoy se llama `markDisconnected`:
   - `src/app/api/webhook/evolution/route.ts` (handler CONNECTION_UPDATE/logout): si `classifyDisconnection(reason)==='banned'` → `markBanned` + `promoteFromReserve`.
   - `src/app/api/cron/leads-pendientes/route.ts` (`claimYEnviarLead`, ~línea 358 `preflight_close` y ~431 `send_failure_threshold`): idem, **cuidando la outage-detection** (no banear en caída del server Evolution).
3. **Integrar `status` en `selectNextSender`** (`src/lib/sender-pool.ts`): active+warming entran al pool; reserve/banned/archived no. Con tests propios (cambia comportamiento del pool).
4. **Programar `tickWarming`** (en `procesarUnTick` junto a `resetDailyCountersIfNeeded`, o cron dedicado).
5. **Alerta a Manuel** cuando un chip se banea (WhatsApp a sí mismo / panel).
6. **Fase 2 anti-ban — arrancar por lo 🔴** (cambios chicos, alto impacto): sin link en primer mensaje, targeting a `websiteUri` vacío, opt-out, cerrar con pregunta. Luego delays con jitter (mover loop a worker Railway), warming activo, peer-warming.
7. **Fase 0 real:** archivar/retirar los 18 viejos cuando haya chips nuevos onboardeados (NO antes, para no quedarse sin el único vivo).

## Estado de implementación (sesión 2 — 2026-06-15)

**Runtime de Fase 1 + Fase 2 🔴 integrados. Migración APLICADA a prod. VERDE:** `npx tsc --noEmit` = 0 · `npx jest` = 292/292. SIN commit, SIN deploy.

### Migración: APLICADA a prod ✅
- Manuel reconectó el MCP genérico de Supabase → ahora alcanza `hpbxscfbnhspeckdmkvu`. Aplicada con `apply_migration`; registrada en `supabase_migrations.schema_migrations` con version `20260615130000` / name `sender_lifecycle` (versión reconciliada para matchear el filename del repo).
- **🐞 Bug de backfill encontrado y corregido** (solo se veía contra datos reales): la columna `status` nace con `DEFAULT 'active'`, así que el paso "archived" original (`status NOT IN ('active','banned')`) no matcheaba a nadie → 6 evolution viejos quedaban `active` en vez de `archived`. **Corregido en prod** (UPDATE) **y en el archivo .sql** (reordenado a banned→archived→active; archiva por `NOT (activo AND connected)`, no por status).
- **Estado final del pool en prod:** `active=1` (solo "Manu celu actual", el único activo+connected), `banned=8`, `archived=9` (6 evolution viejos + 3 twilio). El número vivo, intacto.

### Hecho (código verde, sin deploy)
- **Task 3 — `selectNextSender` filtra por status** (`src/lib/sender-pool.ts`): `status IN ('active','warming')` server-side (`.in`) + filtro JS defensivo. `PoolSender` y `SELECT_FIELDS` ahora incluyen `status`; export `POOL_SELECTABLE_STATUSES`. Tests en `__tests__/sender-pool.test.ts`; se enseñó `.in`/`status` a los mocks de ese archivo y de `sender-pool-roundrobin.test.ts`.
- **Task 2a — baneo en el webhook** (`webhook/evolution/route.ts`, `handleConnectionUpdate`): en `state=close`, si `classifyDisconnection(reason)==='banned'` → `markBanned` + `promoteFromReserve` + `alertSenderBanned`, **bypasseando outage-detection** (un baneo es específico del sender). Gateado por `sender.status !== 'banned'` (no re-promueve/re-alerta ante close-events repetidos).
- **Task 4 — `tickWarming`** corre dentro del bloque throttleado del health-check del cron (~cada 3 min): barato (query indexada sobre `status='warming'`, hoy 0 filas) e idempotente.
- **Task 5 — alerta de baneo por EMAIL** (`src/lib/sender-alerts.ts`): `alertSenderBanned` persiste en `alerts_log` (panel) + email vía Resend. Best-effort (nunca tira). ⚠️ El push por email necesita `RESEND_API_KEY` + `ALERT_EMAIL` en el env de Vercel; sin eso, solo queda el registro en `alerts_log`.
- **Fase 2 🔴 — primer mensaje sin link** (`src/lib/primer-mensaje.ts`, extraído del cron + testeado): el mensaje **default (APEX)** ya NO lleva link → gancho personalizado + opt-out + cierra con pregunta. Las plantillas de proyecto siguen soportando `{{demo_url}}`.
- **Fase 2 🔴 — link al responder** (webhook `full_reply`): bloque `[BOCETO]` que inyecta `lead.pagina_url` (normalizado) al contexto del agente, para que comparta el boceto/demo SOLO cuando el lead muestra interés. Aplica a cualquier proyecto (clave para Carta, que no tiene bloque `[DEMO]`).
- **Targeting 🔴 #2 — YA ESTABA**: `filtro_sin_web` es toggle por proyecto, cableado en UI → `searchPlaces({filtroSinWeb})`. Verificado: **APEX `filtro_sin_web=true`** ✅. Sin código nuevo.

### Task 2b — análisis (NO se agregó código, a propósito)
Los `markDisconnected` del cron usan razones que son **constantes temporales** (`preflight_close`, `send_failure_threshold`) → `classifyDisconnection` siempre da 'temporary'. Un baneo NUNCA llega como error de envío; llega como caída de sesión vía el webhook (statusReason 401 → device_removed). El webhook (2a) es el detector correcto y suficiente → enganchar markBanned en el cron sería **código muerto**. Pendiente opcional (Fase 1.5): heurística "down > N horas y auto-restart falla → banned" como red de seguridad por si el webhook pierde un evento (necesita umbral para no falsear positivos con teléfonos apagados).

### ⚠️ ORDEN DE DEPLOY (crítico)
1. ✅ **Commit** hecho en rama `feat/sender-lifecycle-antiban` (2c59c17). NO mergeado a master, NO pusheado. `next build` verificado OK.
2. **Deploy a Vercel** (pushear/mergear la rama o `vercel --prod`). Seguro: la migración YA está aplicada, así que el código que referencia `status` no rompe ninguna query. Carta (queue activa) mantiene su plantilla con link hasta el paso 3 → el deploy del código solo NO rompe el funnel.
3. **Recién DESPUÉS del deploy: editar la plantilla de Carta en DB** (Carta es la queue activa hoy → `active_queue_project_id`). 🔴 **NO antes del deploy**: si se saca el link de la plantilla sin el código del `[BOCETO]` deployado, los leads de Carta reciben mensaje sin link Y el reply no manda el demo → funnel roto. Deploy primero, plantilla después.
4. Verificar en prod: baneo real → markBanned + promote + email; lead nuevo → 1er mensaje sin link; al responder "dale/mostrame" → llega el boceto.

### Plantillas con link en frío (Carta/Assistify) — copy propuesto, NO aplicado
La queue activa es **Carta** (template propia con `{{demo_url}}`). Edición fiel anti-ban (saca el link, ofrece mostrarlo al responder, agrega opt-out, **mantiene precio y pregunta de cierre**). Aplicar **post-deploy** con:
```sql
UPDATE public.projects SET plantilla_primer_mensaje =
'Hola {{nombre}},

¿Tus mozos todavía anotan pedidos en papel o en el celular y después los cargan en la caja?

Hicimos *Carta* para que eso no pase más, y le armamos una a tu restaurante para mostrarte cómo quedaría.

El cliente escanea el QR de la mesa, ve el menú completo con fotos, elige y manda el pedido directo desde su cel. Vos lo ves en el panel al instante — sin tablet extra, sin app que descargar.

No es para cobrar: es para elegir. El pago sigue en el local como siempre. Solo te ahorra el ida y vuelta del pedido.

Y es un único pago de $70.000, tuyo para siempre. Sin mensualidad.

Si no te interesa, avisame y no te escribo más 🙌

¿Te sirve para tu restaurante?'
WHERE slug = 'carta';
```
**Assistify** (no es la queue activa): su template también manda un link en frío (`assistify.lat/download`). Mismo principio aplica, pero es producto self-serve (el link es descarga de app, no un boceto por-lead → el `[BOCETO]` no le sirve; el link de descarga debería vivir en `project_info` para que el agente lo mande al responder). **Decisión de Manuel pendiente** antes de tocarlo.
