# agente-busca-clientes

Monorepo del producto de prospección automatizada de Manuel. Integra dos canales (WhatsApp + Instagram) con un panel único y un bot de conversación por Claude.

## Servicios

| Servicio | Path | Stack | Deploy | URL |
|---|---|---|---|---|
| Panel + WhatsApp agent | [`apex-leads/`](apex-leads/README.md) | Next.js 14 + TypeScript + Supabase + Claude + Wassenger | Vercel | (privado) |
| Instagram sidecar | [`sidecar/`](sidecar/README.md) | Python 3.11 + FastAPI + instagrapi | Railway | `https://ig-sidecar-production.up.railway.app` |
| Scheduler (cron) | [`sidecar/scheduler/`](sidecar/scheduler/) | Python 3.11 + httpx | Railway cron | diario 12:00 UTC |

Los tres comparten el proyecto Supabase `hpbxscfbnhspeckdmkvu`.

## Arranque rápido

```bash
# Panel (Next.js)
cd apex-leads && npm install && npm run dev

# Sidecar (FastAPI)
cd sidecar && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python -m uvicorn app.main:app --port 8000
```

Ver `apex-leads/README.md` y `sidecar/README.md` para detalles (env vars, migraciones, tests).

## Documentacion

- [Arquitectura](docs/ARCHITECTURE.md) — diagrama de servicios + contrato HTTP.
- [Proyecto IG — master plan](docs/ig/MASTER-PLAN.md) — plan de implementacion del canal Instagram.
- [Proyecto IG — progress](docs/ig/PROGRESS.md) — estado vivo del desarrollo.
- [Contrato sidecar](docs/ig/SIDECAR-CONTRACT.md) — endpoints HTTP entre Next.js y el sidecar.
- [Migracion monorepo](docs/migration/MASTER-PLAN.md) — historial de la consolidacion.

## Convenciones

- Commits: `feat(ig):`, `fix(ig):`, `chore(monorepo):`, `docs(migration):`, etc.
- Branches: trabajo directo en `master` (solo-dev). PRs solo para cambios de alto riesgo.
- Stack fijo: Next.js 14 (panel), Python 3.11 (sidecar), Supabase (DB + auth), Claude (LLM), Railway (Python), Vercel (Next.js).
