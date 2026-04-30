# SESSION-EVO-04 — Big Bang Cutover a Producción

> **Objetivo de esta sesión:** Poner Evolution API en producción como el único canal de WhatsApp. Twilio queda deshabilitado. El agente empieza a mandar mensajes reales por las SIM cards.

---

## Contexto del proyecto

Repositorio: `C:\MisProyectos\bots_ia\agente_busca_clientes`
App: `apex-leads/` (Next.js, Vercel, `leads.theapexweb.com`)
Supabase project: `hpbxscfbnhspeckdmkvu`

### Qué se hizo en sesiones anteriores
- SESSION-EVO-02 + EVO-03 (2026-04-28): Todo el código migrado. Twilio eliminado. TypeScript limpio.
  - `src/lib/evolution.ts` — función `enviarMensajeEvolution(telefono, texto, instanceName)`
  - `src/app/api/webhook/evolution/route.ts` — reemplaza `webhook/twilio/route.ts`
  - `cron/leads-pendientes`, `cron/followup`, `agente/enviar`, `senders/[id]/test`, `agente/diagnostico`, `conversaciones/media` — todos migrados
  - `lib/twilio.ts`, `webhook/twilio/route.ts`, `webhook/twilio-status/route.ts` — eliminados
  - `supabase-migration-evolution-api.sql` — listo para ejecutar

### Lo que falta (esta sesión)
SESSION-EVO-01 (Railway infra) fue deferido — lo haremos aquí si Manuel no lo hizo antes.

---

## Pre-requisitos que Manuel debe tener listos ANTES de empezar esta sesión

1. **SIM cards físicas conectadas** a dispositivos con WhatsApp instalado
2. **Evolution API deployado en Railway** (si no está hecho, hacer en esta sesión):
   - Imagen Docker: `atendai/evolution-api:latest`
   - Variables Railway: `AUTHENTICATION_API_KEY=<secret>`, `DATABASE_ENABLED=false`, `WEBSOCKET_ENABLED=false`
   - Anotar la URL pública: `https://evolution-api-production.up.railway.app` (o similar)
3. **Env vars en Vercel** a agregar:
   - `EVOLUTION_API_URL=https://evolution-api-production.up.railway.app`
   - `EVOLUTION_API_KEY=<mismo secret que AUTHENTICATION_API_KEY de Railway>`
4. **Supabase: ejecutar la migración SQL** en el editor SQL de Supabase:
   - Archivo: `apex-leads/supabase-migration-evolution-api.sql`
   - Agrega columna `instance_name` a tabla `senders`
5. **Webhook configurado en Evolution API** apuntando a:
   - `https://leads.theapexweb.com/api/webhook/evolution`
   - Headers: `apikey: <EVOLUTION_API_KEY>`

---

## Tareas de esta sesión (en orden)

### TAREA 1 — Verificar estado del código en main

```bash
git log --oneline -5
git status
```

Confirmar que el commit `feat(evolution): SESSION-EVO-02+03` está en main y no hay cambios pendientes.

### TAREA 2 — (Si no está hecho) Deploy Evolution API en Railway

Guiar a Manuel paso a paso:
1. Ir a Railway → New Project → Deploy from Docker Image → `atendai/evolution-api:latest`
2. Agregar variables de entorno
3. Exponer puerto 8080
4. Anotar URL pública

### TAREA 3 — Crear instancias en Evolution API (una por SIM card)

Para cada SIM card, llamar a la API de Evolution API:

```bash
# Crear instancia sim01
curl -X POST https://<EVOLUTION_URL>/instance/create \
  -H "apikey: <EVOLUTION_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"instanceName": "sim01", "integration": "WHATSAPP-BAILEYS"}'

# Obtener QR para escanear con el telefono de la SIM
curl https://<EVOLUTION_URL>/instance/connect/sim01 \
  -H "apikey: <EVOLUTION_API_KEY>"
```

Repetir para `sim02`, etc.

### TAREA 4 — Insertar senders en Supabase

Ejecutar en Supabase SQL editor (ajustar datos reales):

```sql
INSERT INTO senders (alias, color, provider, phone_number, instance_name, activo)
VALUES
  ('SIM 01', '#25D366', 'evolution', '+549XXXXXXXXXX', 'sim01', true),
  ('SIM 02', '#128C7E', 'evolution', '+549XXXXXXXXXX', 'sim02', true);

-- Si queres reusar el sender existente de Twilio:
-- UPDATE senders
-- SET provider = 'evolution', instance_name = 'sim01', phone_number = '+549XXXXXXXXXX'
-- WHERE alias = 'assistify_respaldo';
```

### TAREA 5 — Configurar webhook en Evolution API

```bash
curl -X POST https://<EVOLUTION_URL>/webhook/set/sim01 \
  -H "apikey: <EVOLUTION_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook": {
      "enabled": true,
      "url": "https://leads.theapexweb.com/api/webhook/evolution",
      "headers": {"apikey": "<EVOLUTION_API_KEY>"},
      "events": ["MESSAGES_UPSERT", "MESSAGES_UPDATE"]
    }
  }'
```

Repetir para cada instancia.

### TAREA 6 — Deploy a Vercel

Verificar que las env vars `EVOLUTION_API_URL` y `EVOLUTION_API_KEY` están seteadas en Vercel.
Hacer deploy (push a main o trigger manual en Vercel dashboard).

### TAREA 7 — Smoke test

1. Ir a `/senders` en el dashboard APEX y hacer test con un número propio usando el endpoint `POST /api/senders/{id}/test`
2. Verificar que llega el mensaje en el teléfono de la SIM
3. Responder desde ese teléfono — verificar que el webhook recibe y el agente contesta
4. Verificar en `/api/agente/diagnostico` que:
   - `evolution_configurado: true`
   - `agente_activo: true`
   - `anthropic_ok: true`

### TAREA 8 — Deshabilitar Twilio en Vercel

Una vez confirmado que Evolution funciona:
1. En Vercel → Settings → Environment Variables → eliminar o vaciar las vars de Twilio:
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`
   - `TWILIO_ACCOUNT_SID_2`, `TWILIO_AUTH_TOKEN_2`, `TWILIO_WHATSAPP_NUMBER_2`
2. Hacer un redeploy

### TAREA 9 — Actualizar PROGRESS.md y hacer commit final

Marcar SESSION-EVO-04 como completa. La migración está terminada.

---

## Definicion de "sesion completada"

- [ ] Evolution API corriendo en Railway con al menos una instancia conectada via QR
- [ ] Sender(s) insertados en Supabase con `instance_name` correcto
- [ ] Webhook Evolution API apuntando a Vercel production
- [ ] Env vars `EVOLUTION_API_URL` y `EVOLUTION_API_KEY` en Vercel
- [ ] Deploy exitoso en Vercel sin errores de build
- [ ] Smoke test: mensaje enviado + recibido + agente responde
- [ ] Vars Twilio removidas de Vercel
- [ ] PROGRESS.md actualizado, commit en main

---

## Notas adicionales

- **Sin límite hardcodeado de instancias**: agregar mas SIM cards = escanear QR + insertar fila en `senders`. Zero código.
- **Limite diario por instancia**: el `cron/leads-pendientes` distribuye automáticamente entre todos los senders activos. Ajustar cantidad de leads por cron si querés throttling fino.
- **Si Railway ya tiene Evolution API de SESSION-EVO-01**: saltear Tarea 2, ir directo a Tarea 3.
- **Rollback**: si algo falla, re-habilitar las Twilio vars en Vercel (el código Twilio fue eliminado — necesitaria un rollback de git).
