# PROGRESS — Migración Twilio → Evolution API

> **Documento vivo.** Se actualiza al final de cada sesión.

---

## Estado actual

**Ultima sesion completada:** SESSION-EVO-02 + EVO-03 (2026-04-28) — core lib, webhook, callers migrados. Twilio eliminado del código.
**Proxima sesion:** SESSION-EVO-04 — Big bang cutover a producción
**Siguiente prompt:** `docs/migration/evolution-api/prompts/SESSION-EVO-04.md`

---

## Progreso por sesion

- [ ] SESSION-EVO-01 (Sonnet) · Infra Railway: deploy Evolution API + primera instancia QR — **DEFERIDO** (espera SIMs)
- [x] SESSION-EVO-02 (Sonnet) · Core lib `evolution.ts` + webhook route + Supabase schema — **COMPLETO** (2026-04-28)
- [x] SESSION-EVO-03 (Sonnet) · Callers + cleanup Twilio — **COMPLETO** (2026-04-28, combinado con EVO-02)
- [ ] SESSION-EVO-04 (Opus) · Big bang cutover — produccion

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

- Manuel tiene 2 SIM cards disponibles. Conectar via QR en SESSION-EVO-04.
- Decidir `daily_limit` por instancia antes de SESSION-EVO-04 (sugerencia: 15-20 msgs/dia para empezar).
- Ejecutar `supabase-migration-evolution-api.sql` en Supabase antes del cutover.
- Insertar filas de senders en Supabase con los datos reales de cada SIM.

---

## URLs y referencias

- Evolution API Railway: _pendiente SESSION-EVO-01_
- Webhook Vercel nuevo (Evolution): `https://leads.theapexweb.com/api/webhook/evolution`
- Supabase project: `hpbxscfbnhspeckdmkvu`
- Evolution API docs: https://doc.evolution-api.com
