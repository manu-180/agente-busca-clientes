# apex-leads — Panel + WhatsApp agent

Next.js 14 (App Router) + TypeScript + Supabase + Claude + Wassenger.

## Desarrollo local

```bash
npm install
cp .env.local.example .env.local    # completar vars
npm run dev
```

## Variables de entorno

Ver `docs/ig/PROGRESS.md` seccion "Variables de entorno capturadas" para el listado canonico de env vars productivas. En local, minimo:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `WASSENGER_API_KEY`
- Para desarrollo del modulo IG: `IG_SIDECAR_URL`, `IG_SIDECAR_SECRET`, `IG_SENDER_USERNAME`, `CRON_SECRET`, `APIFY_TOKEN`, `APIFY_WEBHOOK_SECRET`, `DRY_RUN=true`.

## Rutas principales

- `src/app/` — UI + API endpoints.
- `src/app/api/ig/` — endpoints del canal Instagram (webhook, run-cycle, cron).
- `src/app/api/webhooks/wassenger/` — inbound WhatsApp.
- `src/lib/ig/config.ts` — validacion fail-fast de env vars del modulo IG.

## Tests

```bash
npm test
```

## Deploy

Vercel lee desde el monorepo con Root Directory = `apex-leads/`.
