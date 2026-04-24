# ig-sidecar — Instagram automation service

FastAPI + instagrapi. Expone endpoints HTTP firmados con HMAC para que el panel (Next.js) pueda interactuar con Instagram sin usar la Graph API oficial.

## Desarrollo local

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt
# Crear .env.local con las vars requeridas (ver seccion Variables de entorno)
.venv/Scripts/python -m uvicorn app.main:app --port 8000
```

## Variables de entorno

Ver `docs/ig/PROGRESS.md` seccion "Railway — ig-sidecar" para el listado productivo. En local:

- `IG_USERNAME`, `IG_PASSWORD` — cuenta IG del bot (NO cuenta personal).
- `IG_TOTP_SEED` — si hay 2FA activado.
- `IG_SIDECAR_SECRET` — secreto HMAC de 64 chars.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- `SIDECAR_DATA_DIR=./data` — override para local (en prod usa `/data` del volumen Railway).

## Endpoints

Contrato completo: [`docs/ig/SIDECAR-CONTRACT.md`](../docs/ig/SIDECAR-CONTRACT.md).

- `GET /health` — status + session validity (sin firma).
- `POST /profile/enrich` — enriquecer perfiles (firmado).
- `POST /dm/send` — enviar DM (firmado).
- `POST /inbox/poll` — leer inbox (firmado).

## Tests

```bash
IG_SIDECAR_SECRET=testsecreto1234567890123456789012 .venv/Scripts/python -m pytest tests/ -v
```

## Deploy

Railway lee desde el monorepo con Root Directory = `sidecar/`. Builder = Dockerfile. Volumen montado en `/data` para persistir `session.json`.

## Scheduler

El cron que dispara `/api/ig/run-cycle` en el panel vive en `scheduler/` como servicio Railway separado.
