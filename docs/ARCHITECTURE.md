# Arquitectura — agente-busca-clientes

## Vision general

Dos canales de prospeccion (WhatsApp + Instagram) con un panel unificado. Un bot de conversacion por Claude. Datos compartidos en Supabase.

## Diagrama

```
                        +---------------------------+
                        |  Supabase (hpbxscfbnhs...)  |
                        |  auth . storage . pg      |
                        +------------+--------------+
                                     |
            +------------------------+------------------------+
            |                        |                        |
    +-------+--------+     +---------+------+     +-----------+-----+
    | apex-leads     |     | ig-sidecar     |     | ig-scheduler    |
    | (Vercel)       |     | (Railway)      |     | (Railway cron)  |
    | Next.js 14     |     | FastAPI        |     | httpx trigger   |
    |                |     | instagrapi     |     |                 |
    +-------+--------+     +--------+-------+     +--------+--------+
            |                       |                      |
            |  HMAC-signed HTTP     |                      |
            +-----------------------+                      |
            ^                                              |
            |  Bearer CRON_SECRET                          |
            +----------------------------------------------+

    +-----------+     +-----------+     +-----------+
    | Wassenger |     | Instagram |     |   Apify   |
    |   (WA)    |     | (unoffic) |     | (discover)|
    +-----+-----+     +-----+-----+     +-----+-----+
          |                 |                 |
          +---> apex-leads  |                 |
                            |                 |
                    ig-sidecar      -----> apex-leads (webhook)
```

## Servicios

### apex-leads (Vercel)

- Panel web (dashboard, inbox, admin).
- API routes para WhatsApp inbound (Wassenger webhook) e Instagram (`/api/ig/*`).
- Agente Claude que responde conversaciones en ambos canales.
- Cron endpoints consumidos por Vercel Cron + Railway scheduler externo.

### sidecar (Railway)

- Wrapper HTTP sobre instagrapi.
- Sesion Instagram persistida en volumen `/data`.
- Circuit breaker contra errores de IG.
- HMAC obligatorio en todos los endpoints excepto `/health`.

### scheduler (Railway cron)

- Ejecucion diaria a las 12:00 UTC.
- Dispara `POST /api/ig/run-cycle` en el panel.
- Runtime minimo (`httpx` + 3 env vars).

## Flujos criticos

### Lead IG outbound

1. Scheduler dispara `/api/ig/run-cycle`.
2. Panel orquesta: obtiene leads pendientes (Supabase) -> llama `sidecar /profile/enrich` -> genera mensaje con Claude -> llama `sidecar /dm/send`.
3. Resultado se logea en `ig_actions` (Supabase).

### Lead WA inbound

1. Usuario escribe al bot en WhatsApp.
2. Wassenger dispara webhook -> `apex-leads/api/webhooks/wassenger`.
3. Agente Claude responde con contexto de DB.

### Circuit breaker

Si Instagram devuelve challenge o action block, el sidecar abre el circuit por N minutos. Durante ese tiempo responde 503 y el scheduler skippea.

## Contratos

- HTTP Next <-> sidecar: [`docs/ig/SIDECAR-CONTRACT.md`](ig/SIDECAR-CONTRACT.md).
- Webhooks externos: Wassenger (WA), Apify (IG discovery).

## Reglas de cambio

- Cambios de contrato HTTP sidecar <-> panel -> versionar en `SIDECAR-CONTRACT.md` + migracion coordinada.
- Cambios de schema Supabase -> migracion via MCP de Supabase + nota en `docs/ig/PROGRESS.md`.
- Env vars nuevas -> documentar en el README del servicio afectado + en `docs/ig/PROGRESS.md`.
