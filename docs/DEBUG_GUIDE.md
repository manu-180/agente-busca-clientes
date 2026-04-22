# APEX Lead Engine — Guía de Debug

Contexto al 21/04/2026: el sistema está enviando mensajes pero con 4 bugs confirmados.
Usá esta guía en Cursor modo auto, parte por parte.

---

## ESTADO ACTUAL (confirmado vía Supabase)

| Métrica | Valor |
|---------|-------|
| Leads outbound contactados | 220 |
| Leads outbound descartados | 39 |
| Leads outbound pendientes | **10 (atascados)** |
| twilio_1 enviados hoy | 20/30 |
| twilio_2 enviados hoy | 21/30 |
| Next slot twilio_1 | 2026-04-21T22:27 UTC (ya pasó) |
| Next slot twilio_2 | 2026-04-21T22:27 UTC (ya pasó) |

---

## BUG 1 — Inbox no muestra conversaciones nuevas después de las 16:11

### Síntoma
El inbox muestra 251 conversaciones todas con timestamp "04:11 p.m." Las enviadas después no aparecen aunque están en Supabase.

### Diagnóstico paso a paso

**Paso 1.1 — Verificar si hay conversaciones nuevas en Supabase:**
```sql
-- Correr en Supabase SQL Editor
SELECT c.lead_id, c.telefono, c.timestamp, l.nombre, l.origen
FROM conversaciones c
LEFT JOIN leads l ON c.lead_id = l.id
WHERE c.timestamp > '2026-04-21 19:11:00+00'  -- 16:11 AR = 19:11 UTC
  AND c.rol = 'agente'
ORDER BY c.timestamp DESC
LIMIT 20;
```

**Paso 1.2 — Verificar si esas conversaciones tienen lead_id válido:**
```sql
-- Si lead_id = null o el JOIN no devuelve nombre, es un bug de FK
SELECT c.id, c.lead_id, c.telefono, l.id as lead_existe
FROM conversaciones c
LEFT JOIN leads l ON c.lead_id = l.id
WHERE c.timestamp > '2026-04-21 19:11:00+00'
  AND l.id IS NULL;  -- Conversaciones huérfanas sin lead
```

**Paso 1.3 — Verificar el polling interval del frontend:**
Archivo: `src/app/conversaciones/page.tsx` o donde se llame `/api/conversaciones`

Buscar: `setInterval`, `useEffect`, `refetch`, `mutate` o similar.
Si el polling está en más de 30 segundos o no existe, las conversaciones no aparecen sin refrescar la página.

**Paso 1.4 — Verificar la query del API:**
Archivo: `src/app/api/conversaciones/route.ts`

La query agrupa por `lead_id` y devuelve hasta 5000 registros ordenados por `ultimo_timestamp` DESC.
Verificar que no tenga un filtro de fecha oculto o una condición que excluya conversaciones sin respuesta del cliente.

### Fix esperado
- Si el problema es polling: reducir el interval a 10s o usar Supabase Realtime
- Si el problema es FK inválido: el cron está guardando `lead_id` incorrecto → ver BUG 3

---

## BUG 2 — 10 leads pendientes que el cron no procesa

### Síntoma
`queue-stats` siempre devuelve 10 pendientes. El cron corre pero no los toca.

### Diagnóstico paso a paso

**Paso 2.1 — Ver cuáles son los 10 leads y por qué se saltan:**
```sql
SELECT id, nombre, telefono, estado, mensaje_enviado, 
       primer_envio_intentos, primer_envio_error, 
       procesando_hasta, created_at
FROM leads
WHERE origen = 'outbound'
  AND mensaje_enviado = false
  AND estado = 'pendiente'
ORDER BY created_at;
```

Cosas a verificar en el resultado:
- `telefono IS NULL` → el cron los descarta (línea 209 de `leads-pendientes/route.ts`)
- `primer_envio_intentos >= 3` → no deberían aparecer (filtro `.lt('primer_envio_intentos', 3)`) pero verificar
- `procesando_hasta` en el futuro → lead bloqueado por otro proceso (lock atómico)
- `telefono` ya existe en otra conversación → se salta y marca como `contactado`

**Paso 2.2 — Verificar si el cron los ve pero los descarta:**
```sql
-- Teléfonos de esos 10 leads que ya tienen conversación
SELECT l.id, l.nombre, l.telefono, c.id as conv_existente
FROM leads l
JOIN conversaciones c ON c.telefono = REGEXP_REPLACE(l.telefono::text, '\D', '', 'g')
WHERE l.origen = 'outbound'
  AND l.mensaje_enviado = false
  AND l.estado = 'pendiente';
```

**Paso 2.3 — Verificar el lock `procesando_hasta`:**
```sql
-- Leads bloqueados por lock expirado
SELECT id, nombre, procesando_hasta
FROM leads
WHERE origen = 'outbound'
  AND mensaje_enviado = false
  AND estado = 'pendiente'
  AND procesando_hasta > NOW();
```

### Fix esperado
- Si `procesando_hasta` está en el futuro y el cron ya terminó: limpiar con `UPDATE leads SET procesando_hasta = NULL WHERE estado = 'pendiente'`
- Si el teléfono tiene formato incorrecto: arreglar en el lead manualmente o en el scraping

---

## BUG 3 — Race condition: el cron envía ráfagas de 20/min en vez de 1 cada 2 min

### Síntoma
Supabase muestra 20 mensajes en el mismo minuto. El config solo cuenta 41 enviados cuando deberían ser muchos más. El slot de cadencia no frena los envíos.

### Causa raíz
GitHub Actions dispara el cron cada ~5 min. Si un run anterior todavía está corriendo cuando arranca el nuevo (o si cron-job.org también está configurado), **dos instancias leen el mismo valor del config al mismo tiempo**, cada una ve `slot_pasado=true`, ambas envían, y ambas escriben `count+1` en vez de `count+2`.

El código NO tiene lock distribuido en `leads-pendientes` (a diferencia de `followup` que sí tiene `try_followup_cron_lock`).

### Diagnóstico paso a paso

**Paso 3.1 — Verificar si cron-job.org también llama a leads-pendientes:**
Ir a console.cron-job.org → Cronjobs → revisar si hay un job apuntando a `/api/cron/leads-pendientes`. Si existe, está duplicando los runs con GitHub Actions.

**Paso 3.2 — Verificar en GitHub Actions si los runs se solapan:**
Ir a github.com/manu-180/apex-leads → Actions → "Cron Leads Pendientes"
Ver si hay runs concurrentes (dos corriendo al mismo tiempo).

**Paso 3.3 — Verificar si el slot se está leyendo bien:**
```sql
-- Ver el valor actual del slot
SELECT clave, valor FROM configuracion
WHERE clave IN (
  'twilio_1_primer_next_slot_at',
  'twilio_2_primer_next_slot_at',
  'twilio_1_primer_enviados_hoy',
  'twilio_2_primer_enviados_hoy'
);
```

Si el slot quedó en el pasado y el cron no lo está avanzando, algo falla en el `escribirConfig` después del envío.

### Fix recomendado

Agregar un lock distribuido en `leads-pendientes` igual al de `followup`.

En `src/app/api/cron/leads-pendientes/route.ts`, al inicio del handler GET:

```typescript
// Después de authCron, antes de procesar:
const { data: lockAcquired } = await sup.rpc('try_leads_cron_lock')
if (!lockAcquired) {
  return NextResponse.json({ ok: true, skipped: 'lock_activo' })
}
try {
  // ... lógica actual ...
} finally {
  await sup.rpc('release_leads_cron_lock')
}
```

Crear la función en Supabase SQL Editor:
```sql
-- Crear lock para leads-pendientes (igual al de followup)
CREATE OR REPLACE FUNCTION try_leads_cron_lock()
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  lock_key text := 'leads_cron_lock';
  lock_expiry interval := '3 minutes';
BEGIN
  -- Intentar insertar el lock
  INSERT INTO configuracion (clave, valor)
  VALUES (lock_key, NOW()::text)
  ON CONFLICT (clave) DO UPDATE
  SET valor = NOW()::text
  WHERE configuracion.valor::timestamp < NOW() - lock_expiry;
  
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION release_leads_cron_lock()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM configuracion WHERE clave = 'leads_cron_lock';
END;
$$;
```

> **Alternativa rápida sin código**: en GitHub Actions, agregar `concurrency` al workflow para que solo corra una instancia a la vez.

En `.github/workflows/cron-leads.yml`:
```yaml
concurrency:
  group: leads-pendientes-cron
  cancel-in-progress: false  # no cancelar, esperar
```

---

## BUG 4 — Followup cron da 504 timeout

### Estado
**Ya fixeado** en commit `4842cea`:
- `maxDuration` bajado de 300 a 60 segundos
- `.limit(15)` agregado a la query de leads
- `--max-time 90` en el curl del GitHub Actions workflow

### Verificar que el fix esté deployado
```bash
# Desde terminal local
curl -s -H "Authorization: Bearer TU_CRON_SECRET" \
  https://apex-leads-six.vercel.app/api/cron/followup | jq .
```
Si responde antes de 60s con `{ ok: true, procesados: N }` → fix funcionando.

Si sigue dando 504: el deploy de Vercel falló. Verificar en vercel.com el último deployment.

---

## BUG 5 — Senders pueden estar pausados automáticamente

### Síntoma
Si Twilio falló 10 veces seguidas, el cron marca el sender como `activo = false` en la tabla `senders`. El cron los salta silenciosamente.

### Diagnóstico

**Paso 5.1:**
```sql
SELECT id, alias, phone_number, activo, provider
FROM senders
ORDER BY activo, alias;
```

**Paso 5.2 — Ver si hay fallos recientes:**
```sql
SELECT clave, valor FROM configuracion
WHERE clave LIKE '%fallos%';
```

### Fix
Si `activo = false`:
```sql
UPDATE senders SET activo = true WHERE activo = false;
```

Y resetear los contadores de fallo:
```sql
UPDATE configuracion SET valor = '0'
WHERE clave IN ('twilio_1_primer_fallos', 'twilio_2_primer_fallos');
```

---

## CHECKLISTS RÁPIDOS

### ¿Por qué el inbox no muestra mensajes nuevos?
- [ ] ¿Hay conversaciones nuevas en Supabase después de las 19:11 UTC? (SQL del BUG 1)
- [ ] ¿Esas conversaciones tienen `lead_id` válido? (SQL del BUG 1.2)
- [ ] ¿El frontend tiene polling activo? (revisar el componente del inbox)
- [ ] ¿Refrescar la página manualmente muestra las nuevas? Si sí → problema de polling

### ¿Por qué no se procesan los 10 leads pendientes?
- [ ] ¿Tienen `procesando_hasta` en el futuro? (SQL BUG 2.3)
- [ ] ¿Su teléfono ya tiene conversación? (SQL BUG 2.2)
- [ ] ¿Los senders alcanzaron el límite diario? (30/día cada uno)
- [ ] ¿Ventana horaria activa? Solo aplica si `first_contact_ventana_horaria_activa` = `true` en `configuracion` (con `false` o ausente, el cron envía 24h). Si está activa, revisar `first_contact_hora_inicio` / `first_contact_hora_fin`.

### ¿Por qué hay ráfagas de mensajes?
- [ ] ¿cron-job.org tiene un job para leads-pendientes? → desactivarlo
- [ ] ¿Los GitHub Actions runs se solapan? → agregar `concurrency`
- [ ] ¿El slot config se está guardando correctamente? (SQL BUG 3.3)

---

## COMANDOS ÚTILES

### Forzar el cron manualmente (para testear):
```bash
curl -s -H "Authorization: Bearer TU_CRON_SECRET" \
  "https://apex-leads-six.vercel.app/api/cron/leads-pendientes?force=true" | jq .
```

### Ver logs en tiempo real:
Vercel Dashboard → apex-leads → Logs → filtrar por `/api/cron/`

### Resetear el slot para que el cron envíe inmediatamente:
```sql
UPDATE configuracion 
SET valor = '1970-01-01T00:00:00.000Z'
WHERE clave IN ('twilio_1_primer_next_slot_at', 'twilio_2_primer_next_slot_at');
```

### Ver qué pasó en las últimas 2 horas:
```sql
SELECT DATE_TRUNC('minute', timestamp) as minuto, rol, COUNT(*) as msgs
FROM conversaciones
WHERE timestamp >= NOW() - INTERVAL '2 hours'
GROUP BY 1, 2
ORDER BY 1 DESC;
```

---

## ARCHIVOS CLAVE DEL SISTEMA

| Función | Archivo |
|---------|---------|
| Cron envío inicial | `src/app/api/cron/leads-pendientes/route.ts` |
| Cron followup | `src/app/api/cron/followup/route.ts` |
| API inbox | `src/app/api/conversaciones/route.ts` |
| API queue stats | `src/app/api/leads/queue-stats/route.ts` |
| Helper Twilio | `src/lib/twilio.ts` |
| GitHub Action leads | `.github/workflows/cron-leads.yml` |
| GitHub Action followup | `.github/workflows/cron-followup.yml` |
| Config Supabase | tabla `configuracion` (clave/valor) |
| Senders activos | tabla `senders` (campo `activo`) |
