# Optimización de Egress — apex-leads (Supabase)

**Fecha:** 2026-06-07
**Contexto:** El proyecto Supabase de apex-leads (`hpbxscfbnhspeckdmkvu`) consumía
**9.27 GB de egress / ciclo (185% de la cuota Free de 5 GB)**. Casi todo el egress
es apex-leads (Demo aporta 0.05 GB). Este doc resume la auditoría, los cambios
aplicados (todos verificados: `tsc` 0 errores, `jest` 223/223), y las palancas
operativas que quedan en manos del usuario.

> **Egress = bytes que SALEN de la DB** = (filas devueltas × ancho de fila) × frecuencia.
> No se reduce con índices; se reduce **trayendo menos filas, menos columnas y con menos frecuencia**.

---

## TL;DR de dónde se iba el egress (ranking)

| # | Fuente | Disparador | Problema | Estado |
|---|--------|-----------|----------|--------|
| 1 | `GET /api/conversaciones` | poll del inbox cada 30s/pestaña | `leads.select('*')` (todas las cols, incl. texto ancho) por CADA hilo | ✅ arreglado |
| 2 | `GET /api/conversaciones/messages` | mismo tick de 30s + cada evento realtime | re-enviaba hasta **5000** mensajes completos del hilo abierto, redundante con realtime | ✅ arreglado |
| 3 | Webhook — historial (`route.ts`) | cada mensaje entrante | `conversaciones` (texto completo) re-leído por mensaje | ✅ acotado |
| 4 | cron `followup` | cada ~5 min × 15 leads | historial completo **sin `.limit()`** por lead | ✅ arreglado |
| 5 | cron `leads-pendientes` | cada ~5 min | `leads.select('*')` filas anchas | ✅ proyectado |
| 6 | Webhook — `leads.select('*')` ×2 | cada mensaje entrante | filas de 30 cols + recarga duplicada | ✅ proyectado |
| 7 | `projects`/`project_info`/`configuracion` | cada mensaje | re-leídos sin caché | ✅ cacheado (TTL) |
| 8 | `GET /api/senders` (sidebar) | sidebar cada 120s, toda página | `select('*, conversaciones(count)')` count sobre tabla entera | ✅ endpoint slim |
| 9 | `GET /api/ig/stats` | cada 180s | 2 scans full-table contados en JS | ✅ count-only |
| 10 | `GET /api/leads` | cada carga de `/leads` | `select('*')` **sin limit** — tabla entera | ✅ cap+proyección |

---

## Cambios aplicados (código)

### Inbox (el mayor consumidor)
- **`src/app/api/conversaciones/route.ts`** — `fetchLeadsByIds` ahora proyecta solo
  `id, nombre, telefono, rubro, estado, agente_activo, boceto_prometido_24h, conversacion_cerrada, project_id` + el `sender` embebido (antes `*`). Esto recorta las columnas anchas (`descripcion`, `mensaje_inicial`, `notas`) de **cada** lead en **cada** poll.
- **`src/app/api/conversaciones/messages/route.ts`** — `MAX_MENSAJES_POR_HILO` 5000 → **300**.
- **`src/app/conversaciones/page.tsx`** — el poll del listado **ya no** re-descarga el
  hilo completo en cada tick (era un 2º fetch a `/messages` redundante). El hilo abierto
  se refresca por **Supabase Realtime** (INSERT) + carga on-select + on-send. Poll del
  listado **30s → 60s**.
  - *Tradeoff:* si Realtime se desconecta, el hilo abierto no se refresca hasta
    re-seleccionar/enviar (el listado sigue refrescando a 60s). Aceptable; Realtime es
    confiable (uso <1% de cuota). Si aparecen mensajes "perdidos", agregar un refetch
    lento de respaldo (cada ~3 min) al hilo abierto.

### Webhook hot path (`src/app/api/webhook/evolution/route.ts`) — corre por CADA mensaje
- `leads.select('*').in('telefono', ...)` → proyección `id, telefono, sender_id, estado, origen, agente_activo, mensaje_enviado, created_at` (las cols anchas no se usan acá; el branch full_reply las re-lee por id).
- recarga `leads.select('*').eq('id')` (full_reply) → `project_id, rubro, descripcion, nombre, zona, mensaje_inicial, conversacion_cerrada`.
- `project_info` → ahora vía `cargarProjectInfoActivo()` **cacheado con TTL**.

### Caché TTL de config casi-estática (nuevo) — `src/lib/ttl-cache.ts`
Cachea en memoria (sobrevive entre invocaciones "calientes" del serverless) lo que el
webhook leía en cada mensaje y casi nunca cambia:
- **`projects`** (`src/lib/projects.ts`, `cargarProyectoPorId/PorSlug`) — TTL `PROJECT_CACHE_TTL_MS` (default 5 min).
- **`project_info`** (`cargarProjectInfoActivo`) — TTL `PROJECT_INFO_CACHE_TTL_MS` (default 5 min).
- **`configuracion`** conversacional (`src/lib/conversation-config.ts`) — TTL `CONV_CONFIG_TTL_MS` (default 60s).

> Staleness: editar la knowledge base / un proyecto / un flag tarda como mucho el TTL en
> propagar. Para forzar propagación inmediata: re-deploy (cold start limpia el caché) o
> bajar el TTL vía env var.

### Crons (corren 24/7 vía railway-cron-pinger)
- **`leads-pendientes/route.ts`** — `leads.select('*')` → proyección de 8 cols usadas.
- **`followup/route.ts`** — (a) `leads.select('*')` → proyección; (b) historial
  `conversaciones` **sin limit** → `.order(desc).limit(8)` + reverse en JS; (c) eliminado
  el full-scan redundante para recontar followups (ya hay un `count:'exact', head:true`).

### Endpoints secundarios
- **`/api/senders?slim=1`** (nuevo modo) devuelve solo `id, alias, activo, project_id`
  sin el join `conversaciones(count)`. El **sidebar** ahora usa `?slim=1`. La página
  `/senders` admin sigue usando el endpoint pesado (necesita los counts).
- **`/api/ig/stats`** — `select('status')` full-table → 14 counts `head:true`; reply-rate
  7d → 2 counts en vez de traer filas.
- **`/api/leads`** — `select('*')` sin limit → proyección de 7 cols + `.limit(1000)`.
- **`/api/dashboard`** — `leads.select('*').limit(10)` → proyección de las cols que renderiza.

---

## ⚠️ Palancas operativas (acción del usuario — NO están en el repo)

1. **Frecuencia del cron `leads-pendientes`** se configura en el **dashboard de Railway**
   (railway-cron-pinger → Cron Schedule), no en el repo. Si está en `*/5` (cada 5 min),
   **bajarlo a `*/10` o `*/15` recorta egress de ese cron a la mitad / un tercio al instante**,
   sin tocar código. Es la palanca más rápida.

2. **Crons IG (`ig-poll-inbox`, `ig-send-pending`) "cada 2 min"**: el comentario en el
   código dice cada 2 min, pero **no hay trigger en el repo** (ni en vercel.json, ni en
   GitHub Actions, ni en railway.toml). Verificar en los dashboards de Vercel/Railway si
   realmente se están pingeando. Si corren cada 2 min, son un consumidor grande y conviene
   pausarlos si el canal IG no está activo.

3. **Plan Supabase**: con estas optimizaciones el objetivo es volver bajo los 5 GB. Si el
   volumen real de mensajes/leads sigue creciendo, evaluar el plan Pro (egress incluido
   mayor) — pero primero medir el efecto de estos cambios (ver SQL abajo).

---

## 📊 SQL para confirmar/medir (pegar en Supabase → SQL Editor)

> No pude consultar la DB de prod desde acá (el MCP genérico quedó scopeado a otro
> proyecto). Corré esto en el **SQL Editor** del proyecto `hpbxscfbnhspeckdmkvu` (corre
> como admin → `pg_stat_statements` disponible).

```sql
-- 1) Top queries por FILAS devueltas (mejor proxy de egress)
select
  s.calls,
  s.rows,
  round((s.rows::numeric / nullif(s.calls,0)),1) as filas_por_call,
  left(regexp_replace(s.query, '\s+', ' ', 'g'), 200) as query
from pg_stat_statements s
where s.query not ilike '%pg_stat%'
order by s.rows desc
limit 25;

-- 2) Top queries por CALLS (presión de polling/cron)
select s.calls, s.rows,
  left(regexp_replace(s.query, '\s+', ' ', 'g'), 200) as query
from pg_stat_statements s
where s.query not ilike '%pg_stat%'
order by s.calls desc
limit 25;

-- 3) Tamaño y filas por tabla (qué tablas son grandes/crecen)
select c.relname as tabla, s.n_live_tup as filas,
  pg_size_pretty(pg_total_relation_size(c.oid)) as total
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_stat_user_tables s on s.relid = c.oid
where n.nspname = 'public' and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc
limit 30;
```

**Para medir la mejora limpia tras el deploy:** justo después de deployar correr
`select pg_stat_statements_reset();` y revisar las queries (1) y (2) unas horas después —
las que dominen el `rows` total son los próximos candidatos.

---

## Verificación
- `npx tsc --noEmit` → **0 errores**
- `npx jest` → **223/223 tests OK** (19 suites)
- `next lint` no está configurado en el repo (pide setup interactivo) → no es un gate.

## Pendiente / próximos pasos (orden de impacto)
1. **Deploy** estos cambios y **medir** con el SQL de arriba (reset + observar unas horas).
2. **Bajar la frecuencia del cron `leads-pendientes`** en Railway (palanca instantánea).
3. **Confirmar** si los crons IG cada 2 min realmente corren; pausarlos si IG está inactivo.
4. Si hace falta más: delta-fetch real en `/api/conversaciones/messages` (traer solo
   `timestamp > último_visto`) y paginación server-side en el inbox para hilos muy largos.
