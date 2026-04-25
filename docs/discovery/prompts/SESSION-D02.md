# SESSION-D02 — Sidecar discovery endpoints (hashtag + location)

> **Modelo recomendado:** Sonnet
> **Duración estimada:** 1 sesión (~1.5h)
> **Prerequisitos:** D01 ✅ (schemas creados).

---

## Contexto

Leé `docs/discovery/MASTER-PLAN.md` § 5.1, 5.2 y `docs/discovery/ARCHITECTURE.md` § 3.1, 3.2, 4.1, 4.2 antes de codear. También `PROGRESS.md`.

Esta sesión expone 2 endpoints HTTP nuevos en el sidecar FastAPI (`sidecar/`). El sidecar ya tiene la sesión `apex.stack` cargada y autenticada. Vamos a darle 2 nuevas capacidades: descubrir leads por hashtag y por location.

Repo path del sidecar: `sidecar/`. Deploy: Railway, autodeploy desde push a `master`.

---

## Objetivo

1. Agregar métodos al `IGClient` (`sidecar/app/ig_client.py`):
   - `discover_by_hashtag(tag: str, limit: int = 50) -> dict`
   - `discover_by_location(location_pk: int, limit: int = 50) -> dict`
2. Crear `sidecar/app/routes/discover.py` con 2 endpoints HTTP firmados HMAC.
3. Registrar router en `sidecar/app/main.py`.
4. Cada endpoint inserta directamente en `instagram_leads_raw` con `ON CONFLICT (ig_username) DO NOTHING` y registra el run en `discovery_runs`.
5. Tests con pytest mockeando instagrapi.
6. Smoke test contra Railway.

---

## Paso 1 — Branch + lectura

```bash
git checkout -b feat/discovery-d02-hashtag-location
```

Lee también:
- `sidecar/app/main.py` — patrón de registro de routers
- `sidecar/app/ig_client.py` — patrón de métodos (signature `_client()`, exception handling)
- Cualquier `routes/*.py` existente — patrón de auth HMAC

Si NO hay routes/ todavía y todo está inline en main.py: refactorizá pero solo mové los endpoints existentes a `routes/` si es trivial. Si es invasivo, dejalo y agregá los nuevos endpoints directo en main.py con un comentario `# TODO: extract to routes/discover.py`.

---

## Paso 2 — Métodos en `IGClient`

```python
def discover_by_hashtag(self, tag: str, limit: int = 50) -> dict:
    """
    Buscar medias recientes en hashtag y devolver perfiles únicos.

    Returns: {"users": [{"ig_username": str, "ig_user_id": str, "raw": dict}], "media_seen": int}
    """
    cl = self._client()
    medias = cl.hashtag_medias_recent(tag, amount=limit)
    seen_users: dict[str, dict] = {}
    for m in medias:
        u = m.user
        if u.username in seen_users:
            continue
        seen_users[u.username] = {
            "ig_username": u.username,
            "ig_user_id": str(u.pk),
            "raw": {
                "full_name": u.full_name,
                "is_private": u.is_private,
                "is_verified": u.is_verified,
                "profile_pic_url": str(u.profile_pic_url) if u.profile_pic_url else None,
                # Más campos los completa enrich después
            },
        }
    return {"users": list(seen_users.values()), "media_seen": len(medias)}
```

Idem `discover_by_location` usando `cl.location_medias_recent(location_pk, amount=limit)`.

Wrap en try/except con el mismo patrón de `circuit_breaker` que usa el resto del módulo (mirá `routes` actuales).

---

## Paso 3 — Router HTTP

`sidecar/app/routes/discover.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from app.ig_client import get_ig_client
from app.auth import verify_signature        # patrón existente
from app.db import supabase                  # cliente existente al final del paso 4

router = APIRouter(prefix="/discover", tags=["discover"])

class HashtagReq(BaseModel):
    tag: str = Field(min_length=1, max_length=100)
    limit: int = Field(default=50, ge=1, le=100)

@router.post("/hashtag", dependencies=[Depends(verify_signature)])
def discover_hashtag(req: HashtagReq):
    ig = get_ig_client()
    if not ig.session_valid:
        raise HTTPException(503, detail={"error": "ig_session_invalid"})
    # Crear discovery_run (running)
    run = supabase.table("discovery_runs").insert({
        "kind": "hashtag", "ref": req.tag, "status": "running",
    }).execute()
    run_id = run.data[0]["id"]
    try:
        result = ig.discover_by_hashtag(req.tag, req.limit)
        # Insertar en raw
        rows = [{
            "ig_username": u["ig_username"],
            "raw_profile": u["raw"],
            "source": "hashtag",
            "source_ref": req.tag,
        } for u in result["users"]]
        if rows:
            supabase.table("instagram_leads_raw").upsert(
                rows, on_conflict="ig_username", ignore_duplicates=True
            ).execute()
        # ... contar `users_new` haciendo select previo o usando returning *
        supabase.table("discovery_runs").update({
            "status": "ok", "ended_at": "now()",
            "users_seen": len(result["users"]),
            "users_new": <delta>,
        }).eq("id", run_id).execute()
        return {"run_id": run_id, "tag": req.tag, "users_seen": len(result["users"]), "users_new": <delta>}
    except Exception as exc:
        supabase.table("discovery_runs").update({
            "status": "error", "ended_at": "now()", "error_message": str(exc)[:500],
        }).eq("id", run_id).execute()
        raise
```

Idem `/location` con `location_pk: int`.

**Para contar `users_new`:** antes del upsert, hacer `select ig_username from instagram_leads_raw where ig_username in (...)` y restar.

---

## Paso 4 — Cliente Supabase en sidecar

Si todavía no existe `app/db.py`:

```python
import os
from supabase import create_client
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
```

Agregar `supabase==2.x` a `requirements.txt`. Verificar env vars en Railway.

---

## Paso 5 — Tests

`sidecar/tests/test_discover.py`:

```python
def test_discover_hashtag_dedups(monkeypatch):
    # Mock IGClient.discover_by_hashtag → 5 users, 2 duplicados
    # Mock supabase chain → no-op + return adecuado
    # POST /discover/hashtag con HMAC válido
    # assert response.users_seen == 5, users_new == ?
```

Cubrir:
- Happy path
- session_invalid → 503
- HMAC inválido → 401
- instagrapi raise → discovery_run queda en `error`

---

## Paso 6 — Deploy + smoke test

```bash
git add -A && git commit -m "feat(discovery): D02 add /discover/hashtag and /discover/location"
git push origin feat/discovery-d02-hashtag-location
```

Railway autodeploya. Esperar deploy verde (`mcp__209aa37b-...__get_deployment` si lo necesitás, o Railway dashboard).

Smoke test:
```bash
SIDECAR_URL=https://ig-sidecar-production.up.railway.app
SECRET=$SIDECAR_SHARED_SECRET
BODY='{"tag":"modaargentina","limit":10}'
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -binary | xxd -p -c 256)

curl -s -X POST "$SIDECAR_URL/discover/hashtag" \
  -H "Content-Type: application/json" \
  -H "X-Signature: $SIG" \
  -d "$BODY" | jq
```

Verificar en Supabase:
```sql
SELECT count(*) FROM instagram_leads_raw WHERE source='hashtag' AND source_ref='modaargentina';
SELECT * FROM discovery_runs ORDER BY started_at DESC LIMIT 5;
```

---

## Criterios de éxito

1. ✅ 2 endpoints firmados HMAC, responden < 30s para limit=50.
2. ✅ Rows en `instagram_leads_raw` con `source` correcto.
3. ✅ `discovery_runs` registra start+end+counts.
4. ✅ Tests pytest verdes (`pytest sidecar/tests/`).
5. ✅ Smoke test contra Railway exitoso.

---

## Cierre

- Update `PROGRESS.md` D02 → ✅, anotar leads encontrados en smoke test.
- PR a master.
