# MASTER-PLAN — Migración WhatsApp: Twilio → Evolution API

> **Documento autoritativo.** Define el trayecto completo para reemplazar Twilio por Evolution API + 10 SIMs en el sistema de leads WhatsApp.
> **No editar** salvo erratas. Las decisiones operativas se registran en `PROGRESS.md`.

---

## 1. Contexto y problema

### Estado actual (funcional pero costoso y limitado)

El sistema de leads WhatsApp usa Twilio como proveedor de WhatsApp Business API:

- **Primer contacto:** cron `leads-pendientes` envía un WhatsApp template via Twilio Content API (`HX1f02dd4ebcbc3af123a8262fdeb5641f`), requiriendo aprobación previa de Meta para cada template.
- **Conversación:** webhook `POST /api/webhook/twilio` recibe mensajes, corre Claude en background, responde via `enviarMensajeTwilio`.
- **Status:** webhook `POST /api/webhook/twilio-status` recibe callbacks de delivery.
- **Senders:** tabla `senders` con `provider: 'twilio'`, actualmente 1 número activo (`+5491125303794`).

**Problemas:**
- Twilio Business API: restricción de templates para primer contacto (no se puede enviar texto libre al cold outreach).
- Costo por mensaje Twilio significativamente mayor que Evolution API.
- Un solo número → volumen máximo limitado por los límites de Meta por número.
- Dependencia de aprobación de templates por Meta.

### Objetivo

Reemplazar Twilio completamente por Evolution API self-hosted en Railway, conectando N números normales de WhatsApp via QR (una SIM por instancia). La cantidad de instancias es ilimitada y se gestiona 100% desde la tabla `senders` de Supabase — se pueden agregar o quitar instancias sin tocar el código. Arrancar con 2 SIMs disponibles hoy, escalar a las que hagan falta.

---

## 2. Principios rectores

1. **Big bang.** No hay dual-write ni feature flag. Cuando todo el código esté listo y la infra operativa, se hace un corte limpio: Evolution API entra en producción, Twilio sale.
2. **Sin templates.** Con números regulares (no Business API oficial), Evolution API puede enviar texto libre para primer contacto. El template de Twilio Content API desaparece.
3. **N SIMs = N instancias.** Cada número es una instancia Evolution API en Railway. La tabla `senders` de Supabase es la fuente de verdad de qué instancias están activas. Agregar una nueva SIM = escanear QR + insertar fila en `senders`. No requiere deploy ni cambio de código.
4. **Round-robin en base de datos.** El cron selecciona el sender activo con menos envíos hoy. No hay lógica de routing en código hardcodeado. Escala a 2, 5, 50 o las instancias que sean sin cambios.
5. **Cero downtime en prod mientras se desarrolla.** Las sesiones 02 y 03 son solo código — no se deployea nada hasta SESSION-EVO-04.
6. **Código limpio.** `twilio.ts` y las rutas `/api/webhook/twilio*` se eliminan completamente. No queda código muerto.
7. **Sesiones limpias.** Una sesión de Claude Code = un objetivo cerrado + handoff escrito.

---

## 3. Arquitectura objetivo

```
Railway (Evolution API service)
├── instancia: sim01  → SIM card 1 (QR conectada)
├── instancia: sim02  → SIM card 2
├── instancia: simXX  → agregar cuantas se quieran
└── ...              → sin limite, sin cambio de codigo

Vercel (Next.js apex-leads/)
├── POST /api/webhook/evolution        ← Evolution API llama aquí con mensajes entrantes
├── POST /api/cron/leads-pendientes    ← Primer contacto (texto libre, no template)
└── POST /api/cron/followup            ← Follow-ups

Supabase
└── tabla senders
    ├── provider: 'evolution'
    ├── instance_name: 'sim01' ... 'sim10'
    └── phone_number: '+5491XXXXXXXXX'
```

### Flujo entrante (cliente escribe)
```
Cliente WA → Evolution API → POST /api/webhook/evolution
                                       ↓
                               Verificar apikey header
                               Parsear JSON payload
                               Lookup lead en Supabase
                               Guardar mensaje en conversaciones
                               waitUntil(procesarEnBackground)
                                       ↓
                               Claude responde
                               enviarMensajeEvolution(telefono, texto, instanceName)
                                       ↓
                               POST https://{EVOLUTION_URL}/message/sendText/{instanceName}
                               { number: "54911...", text: "..." }
                               apikey: {EVOLUTION_API_KEY}
```

### Flujo saliente (cron primer contacto)
```
Cron leads-pendientes
  → seleccionar sender activo (round-robin por envíos_hoy)
  → enviarMensajeEvolution(telefono, texto, instanceName)
  → guardar en conversaciones con sender_id
```

---

## 4. Archivos afectados

### Crear (nuevos)
| Archivo | Descripción |
|---|---|
| `apex-leads/src/lib/evolution.ts` | Core lib: `enviarMensajeEvolution`, `seleccionarSender`, tipos |
| `apex-leads/src/app/api/webhook/evolution/route.ts` | Webhook entrante (reemplaza `twilio/route.ts`) |

### Modificar
| Archivo | Cambio |
|---|---|
| `apex-leads/src/app/api/cron/leads-pendientes/route.ts` | Eliminar Content API template; usar `enviarMensajeEvolution` con texto libre |
| `apex-leads/src/app/api/cron/followup/route.ts` | Reemplazar `enviarMensajeTwilio` por `enviarMensajeEvolution` |
| `apex-leads/src/app/api/agente/enviar/route.ts` | Reemplazar envío Twilio |
| `apex-leads/src/app/api/senders/[id]/test/route.ts` | Usar Evolution API para test |
| `apex-leads/src/app/api/agente/diagnostico/route.ts` | Actualizar referencias Twilio si las hay |
| `apex-leads/src/app/api/conversaciones/media/route.ts` | Actualizar si usa Twilio media URLs |

### Eliminar
| Archivo | Motivo |
|---|---|
| `apex-leads/src/lib/twilio.ts` | Reemplazado por `evolution.ts` |
| `apex-leads/src/app/api/webhook/twilio/route.ts` | Reemplazado por `evolution/route.ts` |
| `apex-leads/src/app/api/webhook/twilio-status/route.ts` | Evolution API envía status en mismo webhook |

### Supabase schema
```sql
-- Agregar columna instance_name a senders
ALTER TABLE senders ADD COLUMN instance_name TEXT;

-- Cuando se conectan las instancias, insertar/actualizar filas:
-- provider: 'evolution', instance_name: 'sim01', phone_number: '+54911...'
```

---

## 5. Contrato Evolution API

### Enviar mensaje
```
POST https://{EVOLUTION_API_URL}/message/sendText/{instanceName}
Headers:
  apikey: {EVOLUTION_API_KEY}
  Content-Type: application/json
Body:
  { "number": "5491112345678", "text": "Hola..." }
```

### Webhook entrante (Evolution API llama a Vercel)
```
POST https://leads.theapexweb.com/api/webhook/evolution
Headers:
  apikey: {EVOLUTION_API_KEY}   ← así verificamos autenticidad
Body (JSON):
  {
    "event": "messages.upsert",
    "instance": "sim01",
    "data": {
      "key": { "remoteJid": "5491112345678@s.whatsapp.net", "fromMe": false },
      "message": { "conversation": "Hola, vi tu mensaje..." },
      "messageTimestamp": 1714320000
    }
  }
```

### Tipos de eventos relevantes
- `messages.upsert` — mensaje nuevo (entrante o confirmación de enviado)
- `messages.update` — cambio de status (delivered, read, failed)

### Variables de entorno nuevas (Vercel)
```
EVOLUTION_API_URL=https://evolution-api-production.up.railway.app
EVOLUTION_API_KEY=<secret generado al deployar>
```

### Variables de entorno a eliminar (Vercel)
```
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_WHATSAPP_NUMBER
TWILIO_ACCOUNT_SID_2
TWILIO_AUTH_TOKEN_2
TWILIO_WHATSAPP_NUMBER_2
```

---

## 6. Plan de sesiones

### SESSION-EVO-01 — Infra Railway: deploy Evolution API
**Modelo:** `claude-sonnet-4-6`
**Tipo:** Solo infra, cero código de aplicación
**Duración estimada:** 45–90 min

**Objetivo:** Tener Evolution API corriendo en Railway, con la primera instancia conectada via QR y una prueba de envío/recepción manual confirmada.

**Entregables:**
- Servicio `evolution-api` corriendo en Railway con `AUTHENTICATION_API_KEY` seteado.
- URL del servicio documentada en `PROGRESS.md`.
- Primera instancia `sim01` creada via API/dashboard.
- QR escaneado con SIM card 1 — instancia `OPEN` confirmada.
- Test manual: curl que envía un WhatsApp y lo recibe en el teléfono.
- Test manual: mensaje entrante llega al webhook de prueba (ngrok o Railway logs).

**Fuera de scope:** Código de la aplicación Next.js. No tocar `apex-leads/`.

---

### SESSION-EVO-02 — Core lib + webhook route + Supabase schema
**Modelo:** `claude-sonnet-4-6`
**Tipo:** Solo código, NO deployear aún
**Duración estimada:** 60–90 min

**Objetivo:** Tener `evolution.ts`, el nuevo webhook, y la migración de Supabase escritos y testeados localmente. No se despliega nada a producción.

**Entregables:**
- `apex-leads/src/lib/evolution.ts` con:
  - `enviarMensajeEvolution(telefono, texto, instanceName)` — wraps Evolution API REST
  - `seleccionarSenderEvolution(supabase)` — elige la instancia activa con menos envíos hoy
  - Tipos `EvolutionSender`
- `apex-leads/src/app/api/webhook/evolution/route.ts` con:
  - Verificación de `apikey` header
  - Parseo del payload JSON de Evolution API
  - Misma lógica de negocio que el webhook Twilio (lock, debounce, Claude, guardrails)
  - Respuesta `200 OK` (no TwiML — Evolution no necesita XML)
- Migración Supabase: `ALTER TABLE senders ADD COLUMN instance_name TEXT`
- `PROGRESS.md` actualizado con decisiones de diseño.

**Fuera de scope:** Actualizar crons, callers Twilio, eliminar archivos viejos. Eso va en EVO-03.

---

### SESSION-EVO-03 — Callers + cleanup Twilio
**Modelo:** `claude-sonnet-4-6`
**Tipo:** Solo código, NO deployear aún
**Duración estimada:** 60–90 min

**Objetivo:** Todos los callers de `enviarMensajeTwilio` migrados a `enviarMensajeEvolution`. Código Twilio eliminado. El repo compila sin errores con `tsc --noEmit`.

**Entregables:**
- `cron/leads-pendientes`: eliminar `TWILIO_CONTENT_SID` y Content API template; reemplazar con `enviarMensajeEvolution` + texto libre configurable desde `apex_info`/DB.
- `cron/followup`: reemplazar `enviarMensajeTwilio` por `enviarMensajeEvolution`.
- `agente/enviar`: reemplazar envío.
- `senders/[id]/test`: usar Evolution API.
- `agente/diagnostico` y `conversaciones/media`: revisar y limpiar refs Twilio.
- DELETE: `apex-leads/src/lib/twilio.ts`.
- DELETE: `apex-leads/src/app/api/webhook/twilio/route.ts`.
- DELETE: `apex-leads/src/app/api/webhook/twilio-status/route.ts`.
- `tsc --noEmit` en `apex-leads/` sin errores.
- `PROGRESS.md` actualizado.

**Fuera de scope:** Configurar webhook en Evolution API, conectar instancias, deploy a prod.

---

### SESSION-EVO-04 — Big bang cutover
**Modelo:** `claude-opus-4-7` (decisiones en vivo, alta criticidad)
**Tipo:** Deploy + infra + config
**Duración estimada:** 60–120 min

**Objetivo:** Evolution API en producción. Twilio desactivado. Sistema funcionando end-to-end con al menos 1 instancia.

**Orden de operaciones (crítico):**
1. Verificar que Evolution API en Railway está `OPEN` para sim01.
2. Configurar webhook URL en sim01: `POST /instance/config/sim01` con `webhook.url = https://leads.theapexweb.com/api/webhook/evolution`.
3. Agregar env vars en Vercel: `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`.
4. Insertar fila en tabla `senders` para sim01 (`provider: 'evolution'`, `instance_name: 'sim01'`).
5. Deploy a Vercel production (el nuevo código).
6. Smoke test: enviar mensaje al número de sim01 → confirmar que llega al webhook y Claude responde.
7. Smoke test: trigger manual `cron/leads-pendientes` con `?force=true` para un lead de prueba.
8. Si todo verde: eliminar env vars Twilio de Vercel.
9. Conectar instancias sim02–sim10 (repetir QR scan por cada SIM, insertar en `senders`).
10. `PROGRESS.md` firmado.

**Entregables:**
- Sistema en producción con Evolution API.
- Tabla `senders` con 10 filas (o las que estén disponibles el día de la sesión).
- Env vars Twilio eliminadas de Vercel.
- `PROGRESS.md` con checklist firmado.

**Fuera de scope:** Features nuevas.

---

## 7. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Ban de número WhatsApp durante pruebas | Media | Alto | Usar SIM cards con historia (no nuevas), limitar a 10-20 mensajes/día por instancia. No enviar al mismo número dos veces seguidas desde la misma instancia. |
| Evolution API Railway cae (OOM, crash) | Media | Alto | Configurar Railway restart policy. Evolution API persiste sesiones en volumen. Si cae, re-escanear QR es el plan B. |
| Webhook de Evolution API no llega a Vercel | Baja | Alto | Verificar config en sim01 antes del cutover. Testear con un mensaje real antes de switchover. |
| `tsc --noEmit` falla después de eliminar Twilio | Baja | Medio | Hacerlo explícitamente en EVO-03 antes de mergear. |
| Media (imágenes/audio) en Evolution API tiene formato diferente | Media | Bajo | En EVO-02, mapear el payload de media de Evolution API al tipo interno `tipoMensaje`. |
| Pérdida de mensajes durante el corte | Baja | Alto | El cutover es un deploy de Vercel (segundos). Mensajes entrantes durante el deploy se pierden; aceptable para un proyecto personal. |
| Meta ban de número outbound agresivo | Media | Medio | Respetar daily cap por instancia (configurable en `senders`). Empezar con 10 msgs/instancia/día, ramp up gradual. |

---

## 8. Reglas generales (TODA sesión de este plan)

1. **Leer primero** `docs/migration/evolution-api/MASTER-PLAN.md` + `docs/migration/evolution-api/PROGRESS.md`. No asumir nada.
2. **No deployear** hasta SESSION-EVO-04. Las sesiones 01-03 son infra local y código local.
3. **Commits atómicos** con prefixes: `feat(evolution):`, `chore(evolution):`, `fix(evolution):`.
4. **No tocar** la lógica de negocio del agente (prompts, guardrails, decision engine). Solo cambiar la capa de transporte WA.
5. **Actualizar `PROGRESS.md`** al final de cada sesión.
6. **Escribir el prompt de la siguiente sesión** al cerrar.
7. **No emojis en código ni docs.**
8. **tsc --noEmit** verde antes de cerrar cualquier sesión de código.

---

## 9. Definición de "migración completa"

- [ ] Evolution API corriendo en Railway con volumen montado (sesiones persistentes).
- [ ] 10 instancias (`sim01`–`sim10`) conectadas via QR y en estado `OPEN`.
- [ ] Tabla `senders` en Supabase con al menos 1 fila `provider: 'evolution'` activa (escalar a N sin code change).
- [ ] `apex-leads/src/lib/twilio.ts` eliminado del repo.
- [ ] `apex-leads/src/app/api/webhook/twilio/route.ts` eliminado.
- [ ] `apex-leads/src/app/api/webhook/twilio-status/route.ts` eliminado.
- [ ] Vercel producción deployado con código Evolution API.
- [ ] Env vars Twilio eliminadas de Vercel.
- [ ] Smoke test entrante: mensaje WA → Claude responde correctamente.
- [ ] Smoke test saliente: cron leads-pendientes envía primer contacto via Evolution API.
- [ ] `PROGRESS.md` con checklist firmado y fecha de cierre.

---

## 10. Referencias

- Código Twilio actual: `apex-leads/src/lib/twilio.ts`, `apex-leads/src/app/api/webhook/twilio/route.ts`
- Tabla senders: Supabase project `hpbxscfbnhspeckdmkvu`
- Stack: Next.js 14 en Vercel (`apex-leads/`), Railway (Evolution API + crons)
- Migración monorepo cerrada: `docs/migration/PROGRESS.md`
- Evolution API docs: https://doc.evolution-api.com
