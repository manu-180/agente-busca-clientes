# SESSION-04 — Sidecar: deploy Railway + login real

**Modelo recomendado:** `claude-opus-4-7`
**Permisos recomendados:** bash (para Railway CLI, curl smoke tests)
**Duración estimada:** 30–60 min

---

## Rol y contexto

Sos un ingeniero backend senior con experiencia en Railway, FastAPI, instagrapi y deployments Docker.
Seguís trabajando en "Agente Instagram APEX" de Manuel.

**Trabajo previo:**
- SESSION-01 — auditoría + `apex-leads/src/lib/ig/config.ts` + contrato sidecar (`docs/ig/SIDECAR-CONTRACT.md`).
- SESSION-02 — `sidecar/` scaffolding con FastAPI + middleware HMAC + 4 endpoints STUB + 8 pytest cases + Dockerfile + railway.toml.
- SESSION-03 — `sidecar/app/` completo con instagrapi real: `ig_client.py`, `session_store.py`, `circuit_breaker.py`, `humanize.py`, routes reales, 15 tests pasando, `ig-sidecar/` eliminado.

**El sidecar está 100% funcional en local. El objetivo de SESSION-04 es llevarlo a producción.**

## Paso 0 — Orientación (OBLIGATORIO)

Antes de tocar nada:

1. Leé `docs/ig/MASTER-PLAN.md` sección 5 (SESSION-04).
2. Leé `docs/ig/PROGRESS.md` completo (estado vivo).
3. Leé `sidecar/Dockerfile` y `sidecar/railway.toml` — confirmar que están correctos para producción.
4. Leé `sidecar/app/main.py` — confirmar el lifespan de login.
5. Confirmá al usuario en 1–2 oraciones que entendés el scope antes de arrancar.

## Scope de SESSION-04

### Objetivo único
Deployar el sidecar en Railway con Dockerfile, montar el volumen persistente en `/data`, setear env vars reales, hacer el primer login real contra la cuenta Instagram del bot, y verificar que `/health` responde `"status": "ok"` desde fuera.

### Inputs requeridos de Manuel (pedirlos si faltan)
- `IG_USERNAME` — el username de la cuenta Instagram que va a enviar DMs (NO una cuenta personal).
- `IG_PASSWORD` — la contraseña de esa cuenta.
- `IG_TOTP_SEED` — solo si la cuenta tiene 2FA por TOTP activado. Si no tiene 2FA, omitir.
- `IG_SIDECAR_SECRET` — generar un valor real de 64 chars aleatorios: `python -c "import secrets; print(secrets.token_hex(32))"`.
- Confirmación de que el proyecto Railway existe o instrucciones para crearlo.

### Tareas concretas

#### 1. Revisar Dockerfile

Verificar que `sidecar/Dockerfile`:
- Usa Python 3.11+ (no 3.13+ por compatibilidad de instagrapi).
- Copia `requirements.txt` e instala dependencias antes de copiar el código (cache de capas).
- Declara `VOLUME /data` o lo documenta para que Railway lo monte.
- El CMD es `uvicorn app.main:app --host 0.0.0.0 --port $PORT` (Railway inyecta `$PORT`).
- Si el Dockerfile no está bien, corregirlo ahora.

#### 2. Revisar railway.toml

Verificar que `sidecar/railway.toml`:
- Apunta al Dockerfile correcto.
- Health check path = `/health`.
- Restart policy = `on-failure`.
- Si falta algo, corregirlo.

#### 3. Crear / configurar servicio en Railway

```bash
# Si railway CLI está instalado:
railway login
railway link   # linkear al proyecto existente
# O crear nuevo proyecto desde el dashboard Railway con source = Dockerfile
```

- Servicio: `ig-sidecar`
- Root directory: `sidecar/`
- Build: Dockerfile

#### 4. Setear env vars en Railway

En el dashboard Railway → Environment del servicio `ig-sidecar`, setear:

```
IG_USERNAME=<cuenta_bot>
IG_PASSWORD=<password>
IG_TOTP_SEED=<seed_si_aplica>
IG_SIDECAR_SECRET=<64_chars_random>
SUPABASE_URL=https://hpbxscfbnhspeckdmkvu.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<copiar_de_vercel>
```

NO setear `SIDECAR_DATA_DIR` — el sidecar usará `/data` por default.

#### 5. Montar volumen persistente en Railway

En el dashboard Railway → servicio `ig-sidecar` → Volumes:
- Mount path: `/data`
- Esto garantiza que `session.json` sobrevive redeployments.

**Crítico:** sin volumen, cada redeploy requiere re-login → riesgo de challenge → ban.

#### 6. Primer deploy

```bash
railway up   # o push via git trigger
```

Monitorear logs en Railway dashboard:
- Esperar: `"Instagram session ready."` o `"Fresh login successful"`
- Si aparece `"Instagram login failed at boot"`: ver sección de troubleshooting.

#### 7. Login interactivo si hay challenge

Si Instagram exige verificación de identidad (challenge) en el primer login:
- En Railway dashboard → servicio → Shell:
  ```bash
  cd /app
  python -c "
  from instagrapi import Client
  import json, os
  cl = Client()
  cl.login(os.environ['IG_USERNAME'], os.environ['IG_PASSWORD'])
  with open('/data/session.json', 'w') as f:
      json.dump(cl.get_settings(), f)
  print('Session saved.')
  "
  ```
- Si pide código de verificación → ingresarlo manualmente en el shell.
- Redeploy después para que el sidecar cargue la sesión persistida.

#### 8. Smoke test desde local

```bash
URL=https://<ig-sidecar-xxx>.up.railway.app
SECRET=<IG_SIDECAR_SECRET>

# Health (sin firma)
curl $URL/health
# Esperado: {"status":"ok","session_valid":true,"last_action_at":null}

# Profile enrich (con firma)
BODY='{"usernames":["instagram"]}'
SIG="sha256=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')"
curl -X POST $URL/profile/enrich \
  -H "Content-Type: application/json" \
  -H "X-Sidecar-Signature: $SIG" \
  -d "$BODY"
# Esperado: perfil real de @instagram con followers_count > 0
```

#### 9. Verificar sesión persistida

```bash
# En Railway shell:
cat /data/session.json | python -m json.tool | head -20
# Debe mostrar settings de instagrapi con cookies, device_settings, etc.
```

#### 10. Actualizar env var en Vercel

Una vez que el sidecar tiene URL pública:
- En Vercel → `apex-leads` → Environment Variables:
  - `IG_SIDECAR_URL` = `https://<ig-sidecar-xxx>.up.railway.app`
  - `IG_SIDECAR_SECRET` = (mismo valor que en Railway)

### Fuera de scope (NO hacer ahora)
- Scheduler (SESSION-05).
- Primer DM real al bot cuenta de prueba (SESSION-10).
- Ramp-up (SESSION-11).
- Deploy Next.js a Vercel (SESSION-06).

## Definición de "terminado"

- [ ] Sidecar deployado en Railway con Dockerfile.
- [ ] Volumen `/data` montado y `session.json` creado tras el primer login.
- [ ] `curl $URL/health` → `{"status":"ok","session_valid":true,...}` desde internet.
- [ ] `POST /profile/enrich` con username real devuelve datos reales (no hardcodeados).
- [ ] `IG_SIDECAR_URL` seteada en Vercel con la URL pública del sidecar.
- [ ] `PROGRESS.md` actualizado.
- [ ] `docs/ig/prompts/SESSION-05.md` creado.
- [ ] Commit: `feat(ig): session-04 sidecar deploy Railway + session persistida`.

## Al terminar la sesión

Escribí `docs/ig/prompts/SESSION-05.md` con el mismo formato. Contenido:

**SESSION-05 — Scheduler Python en Railway**
- Modelo: `claude-sonnet-4-5` (Sonnet según MASTER-PLAN)
- Scope: crear `sidecar/scheduler/` (mismo repo, 2do service Railway), APScheduler con 6 jobs (`ig-discover`, `ig-enrich`, `ig-send-pending`, `ig-poll-inbox`, `ig-followup`, `ig-daily`), cada job hace POST a `NEXT_APP_URL/api/cron/<name>` con Bearer CRON_SECRET, loggea start/end/status a `cron_runs` (Supabase), reintenta en 15 min si Next devuelve 503, deploy como 2do service Railway.
- Referencias: `docs/ig/MASTER-PLAN.md` sección 5 (TANDA 1 SESSION-05), `sidecar/` completa.
- Fuera de scope: crons reales disparando (Next.js no deployado aún, SESSION-06).

Después, mensaje final al usuario:
1. Resumir en 3–5 bullets qué se hizo.
2. Listar bloqueos/inputs humanos para SESSION-05 (p.ej. `CRON_SECRET` a generar, decisión sobre frecuencia de los jobs).
3. Mostrar el comando exacto:
   ```
   Nueva sesión de Claude Code → /model claude-sonnet-4-5 → copiar contenido de docs/ig/prompts/SESSION-05.md
   ```

## Reglas generales para TODA sesión de este proyecto

1. **Siempre leer MASTER-PLAN.md y PROGRESS.md primero**. No asumir nada.
2. **Actualizar PROGRESS.md al final**. Es la memoria.
3. **Escribir el SESSION-(XX+1).md al final**. Es el handoff.
4. **Commits atómicos** con prefijo `feat(ig):`, `fix(ig):`, `chore(ig):`, `docs(ig):` según corresponda.
5. **Nunca editar MASTER-PLAN.md** salvo erratas o clarificaciones.
6. **Stack fijo**: Next.js 14 + TypeScript strict + Supabase + Python 3.11 (sidecar/scheduler) + instagrapi. NO proponer alternativas.
7. **No emojis** en código ni docs (sí en conversación con Manuel si ayuda).
8. **Arquitectura limpia**: separación de concerns, funciones chicas, tests donde aporte, sin abstracciones prematuras.
