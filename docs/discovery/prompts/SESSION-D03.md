# SESSION-D03 — Sidecar discovery (competitor-followers + post-engagers)

> **Modelo recomendado:** Sonnet
> **Duración estimada:** 1 sesión (~1.5h)
> **Prerequisitos:** D02 ✅

---

## Contexto

Leé `MASTER-PLAN.md` § 5.3, 5.4 y `ARCHITECTURE.md` § 3.3, 3.4. PROGRESS.md.

Esta sesión añade las 2 fuentes de discovery más sensibles al rate-limit de Instagram. `competitor-followers` paginado (200/run con cursor), `post-engagers` para likers/commenters de un post específico.

**CUIDADO:** estos endpoints, si se llaman en bucle sin freno, son los que más fácil disparan un challenge de IG. Hay que implementar guards estrictos.

---

## Objetivo

1. Métodos en `IGClient`:
   - `discover_competitor_followers(username: str, max_users: int = 200, cursor: str | None = None) -> dict`
   - `discover_post_engagers(media_pk: str, kind: Literal["likers","commenters"]) -> dict`
2. Endpoints HTTP en `routes/discover.py`.
3. **Rate-limit guard a nivel app:** tabla `sidecar_rate_limits` (o usar Redis si Railway lo tiene; si no, tabla simple Supabase) con `(endpoint, key) → last_called_at`. Reject `429 rate_limited` si llamada se repite antes de cooldown.
4. Cooldowns:
   - `competitor-followers`: 1 hora por `username`
   - `post-engagers`: 30 min por `media_pk`
5. Tests + smoke.

---

## Paso 1 — Branch + lectura

```bash
git checkout master && git pull
git checkout -b feat/discovery-d03-competitors-engagers
```

---

## Paso 2 — Métodos `IGClient`

```python
def discover_competitor_followers(self, username: str, max_users: int = 200, cursor: str | None = None) -> dict:
    cl = self._client()
    user_id = cl.user_id_from_username(username)
    # instagrapi soporta cursor con user_followers_v1 / gql
    followers_chunk, next_cursor = cl.user_followers_v1_chunk(user_id, max_amount=max_users, end_cursor=cursor or "")
    users = [{
        "ig_username": u.username,
        "ig_user_id": str(u.pk),
        "raw": {
            "full_name": u.full_name,
            "is_private": u.is_private,
            "is_verified": u.is_verified,
            "profile_pic_url": str(u.profile_pic_url) if u.profile_pic_url else None,
        },
    } for u in followers_chunk]
    return {"users": users, "next_cursor": next_cursor or None}

def discover_post_engagers(self, media_pk: str, kind: str) -> dict:
    cl = self._client()
    if kind == "likers":
        users_raw = cl.media_likers(media_pk)
    else:
        # comments: extraer .user de cada comment
        comments = cl.media_comments(media_pk, amount=100)
        users_raw = [c.user for c in comments]
    seen: dict[str, dict] = {}
    for u in users_raw:
        if u.username in seen: continue
        seen[u.username] = {
            "ig_username": u.username, "ig_user_id": str(u.pk),
            "raw": {"full_name": u.full_name, "is_private": u.is_private, "is_verified": u.is_verified},
        }
    return {"users": list(seen.values())}
```

(Nombres exactos de métodos instagrapi pueden variar; verificar con `dir(cl)` o docs en el primer test.)

---

## Paso 3 — Rate-limit guard

Crear tabla simple en Supabase (D01 no la incluyó porque es ops, no datos del dominio):

```sql
CREATE TABLE IF NOT EXISTS sidecar_rate_limits (
  endpoint     text NOT NULL,
  key          text NOT NULL,
  last_call_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (endpoint, key)
);
```

Aplicar via MCP `apply_migration` con name `discovery_v2_rate_limits`.

Helper Python:
```python
def check_and_mark(endpoint: str, key: str, cooldown_seconds: int) -> bool:
    """Returns True if allowed, False if rate-limited."""
    row = supabase.table("sidecar_rate_limits").select("last_call_at").eq("endpoint", endpoint).eq("key", key).maybe_single().execute()
    if row.data:
        delta = (now_utc() - parse(row.data["last_call_at"])).total_seconds()
        if delta < cooldown_seconds:
            return False
    supabase.table("sidecar_rate_limits").upsert({
        "endpoint": endpoint, "key": key, "last_call_at": "now()",
    }).execute()
    return True
```

---

## Paso 4 — Endpoints HTTP

```python
class CompetitorReq(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    max_users: int = Field(default=200, ge=10, le=500)
    cursor: str | None = None

@router.post("/competitor-followers", dependencies=[Depends(verify_signature)])
def discover_competitor(req: CompetitorReq):
    if not check_and_mark("competitor_followers", req.username, 3600):
        raise HTTPException(429, detail={"error": "rate_limited", "retry_after_seconds": 3600})
    # ... patrón estándar: crear discovery_run, llamar IGClient, upsert raw, update run
```

`/post-engagers`:
```python
class EngagersReq(BaseModel):
    media_pk: str
    kind: Literal["likers","commenters"] = "likers"

@router.post("/post-engagers", dependencies=[Depends(verify_signature)])
def discover_engagers(req: EngagersReq):
    if not check_and_mark("post_engagers", req.media_pk, 1800):
        raise HTTPException(429, ...)
    ...
```

Para `competitor-followers`, el `users_new` cuenta + el `next_cursor` se devuelven al caller (orchestrator decidirá si paginar).

---

## Paso 5 — Tests

Cubrir además del happy/error:
- Rate-limit hit → 429
- Cursor pagination devuelve next_cursor cuando IG tiene más
- post-engagers con kind inválido → 422 (Pydantic)

---

## Paso 6 — Smoke test

```bash
# competitor-followers (usar una cuenta pública grande para test, NO sumarle leads garbage al pipeline)
BODY='{"username":"<account_pública_test>","max_users":50}'
# computa SIG con HMAC y curl como en D02
```

Verificar en Supabase:
- Row en `sidecar_rate_limits` con `endpoint=competitor_followers`
- Segundo call mismo username dentro de 1h → 429
- `discovery_runs` con `kind=competitor_followers`

---

## Criterios de éxito

1. ✅ 2 endpoints nuevos, firmados HMAC.
2. ✅ Rate-limit guard funciona (segunda llamada → 429).
3. ✅ `next_cursor` retornado cuando hay más data.
4. ✅ Tests pytest verdes.
5. ✅ Smoke test exitoso, no se dispara challenge en cuenta `apex.stack` (chequear `/health` después).

---

## Cierre

- Update PROGRESS.md D03 → ✅
- PR + commit `feat(discovery): D03 add competitor-followers and post-engagers endpoints`

---

## Notas anti-ban

- NO llamar competitor-followers más de 1× / hora total en producción (no por username, **total**). El orchestrator de D04 va a respetar esto seleccionando 1 source competitor cada hora máximo.
- post-engagers solo se llama desde admin manual o desde un cron baja-frecuencia (1× / día por post).
- Si después de un test ves `/health` con `session_valid=false` → re-login manual desde Railway, no automatizar (challenge se rompe con auto-login bots).
