# SESSION-MIG-03 — Monorepo hygiene + limpieza archivos pesados

**Modelo recomendado:** `claude-sonnet-4-6`
**Permisos recomendados:** bash
**Duración estimada:** 30–60 min

---

## Rol y contexto

Sos un ingeniero senior con experiencia en organización de monorepos, arquitectura limpia y documentación técnica. Seguís el plan de consolidación de Manuel (`docs/migration/MASTER-PLAN.md`).

**Trabajo previo:**
- SESSION-MIG-01 — sincronización y backup.
- SESSION-MIG-02 — subtree merge completo, `apex-leads/` ahora es un directorio regular con historial preservado.

**Esta es la SESIÓN 3 de 5.** Objetivo: dejar el monorepo con estructura profesional, documentación root, gitignore unificado, sin archivos basura (zip de 160 MB) ni duplicados (`scheduler/` en root).

## Paso 0 — Orientación (OBLIGATORIO)

1. Leé `docs/migration/MASTER-PLAN.md` secciones 3 (estructura objetivo) y 5 (plan de sesiones).
2. Leé `docs/migration/PROGRESS.md` — confirmá que MIG-02 está marcado como `[x]`.
3. Leé `docs/ig/MASTER-PLAN.md` y `docs/ig/PROGRESS.md` para entender el proyecto IG (no se toca, pero hay que documentarlo correctamente en ARCHITECTURE.md).
4. Confirmá al usuario en 1–2 oraciones el plan antes de arrancar.

## Scope de SESSION-MIG-03

### Objetivo único
Monorepo con: `README.md` root claro, `.gitignore` unificado, `docs/ARCHITECTURE.md`, READMEs por servicio, sin `apex-leads.zip`, sin `scheduler/` duplicado.

### Tareas concretas

#### 1. Verificar que el zip no está en git history
El `apex-leads.zip` (163 MB) está en disco. Verificar si está en el historial de git (importante — si está, hay que decidir si remediamos en otra sesión):

```bash
# Buscar en todo el historial
git log --all --oneline -- apex-leads.zip 2>/dev/null | head -5
git log --all --diff-filter=A -- apex-leads.zip 2>/dev/null | head -5

# Cálculo de tamaño del pack (si es gigante, confirma que hay binarios)
git count-objects -vH
```

**Si `apex-leads.zip` NO está en history:** listo, lo borramos del disco y seguimos.
**Si SÍ está en history:** documentarlo como bloqueo, agregar a `.gitignore`, borrar del disco y del próximo commit, pero dejar la limpieza profunda (`git filter-repo`) para una sesión extra (SESSION-MIG-03b si aplica). NO hacer `git filter-repo` en esta sesión.

```bash
# En cualquier caso: agregar al gitignore + borrar del disco
echo "apex-leads.zip" >> .gitignore
rm apex-leads.zip
```

#### 2. Eliminar el `scheduler/` duplicado en root
`scheduler/` root es copia exacta de `sidecar/scheduler/`. La versión canónica es la de adentro de `sidecar/` (es la que deploya Railway).

```bash
# Verificar que son idénticos
diff -rq scheduler/ sidecar/scheduler/

# Si no hay diferencias funcionales, eliminar la duplicada
git rm -r scheduler/
```

Si hay diferencias reales, parar y consultar a Manuel.

#### 3. `.gitignore` unificado en root
Reemplazar/ampliar el `.gitignore` root para cubrir Node, Python, Docker, IDE, OS. Contenido propuesto:

```gitignore
# Dependencies
node_modules/
**/node_modules/
.venv/
**/.venv/
venv/
**/venv/
__pycache__/
**/__pycache__/
*.py[cod]
*.egg-info/

# Build outputs
.next/
**/.next/
out/
**/out/
dist/
**/dist/
build/
**/build/
*.tsbuildinfo

# Environment files
.env
.env.local
.env.*.local
**/.env
**/.env.local

# Instagram sidecar — secretos de sesión, NUNCA commitear
sidecar/session_b64.txt
sidecar/session_export.json
sidecar/data/
**/data/session.json

# Backups locales de migración
backup/
*.bundle

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Testing / coverage
coverage/
.pytest_cache/
.coverage
htmlcov/

# IDE / editor
.vscode/
.idea/
*.swp
*.swn
.DS_Store
Thumbs.db

# Vercel
.vercel

# Claude / local memory
.remember/
.claude/

# Large assets (explícitos)
apex-leads.zip
*.zip
```

**Importante:** revisar que los `.gitignore` internos (`apex-leads/.gitignore`, `sidecar/.gitignore`) no contradigan el root. Si hay reglas específicas por servicio (por ejemplo `.next/` solo en apex-leads), mantenerlas en el gitignore interno.

#### 4. `.editorconfig` root
```
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space
indent_size = 2

[*.py]
indent_size = 4

[*.md]
trim_trailing_whitespace = false

[Makefile]
indent_style = tab
```

#### 5. `README.md` root del monorepo
Contenido: identidad, servicios, cómo arrancar, links a docs. Propuesta:

```markdown
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

## Documentación

- [Arquitectura](docs/ARCHITECTURE.md) — diagrama de servicios + contrato HTTP.
- [Proyecto IG — master plan](docs/ig/MASTER-PLAN.md) — plan de implementación del canal Instagram.
- [Proyecto IG — progress](docs/ig/PROGRESS.md) — estado vivo del desarrollo.
- [Contrato sidecar](docs/ig/SIDECAR-CONTRACT.md) — endpoints HTTP entre Next.js y el sidecar.
- [Migración monorepo](docs/migration/MASTER-PLAN.md) — historial de la consolidación.

## Convenciones

- Commits: `feat(ig):`, `fix(ig):`, `chore(monorepo):`, `docs(migration):`, etc.
- Branches: trabajo directo en `master` (solo-dev). PRs solo para cambios de alto riesgo.
- Stack fijo: Next.js 14 (panel), Python 3.11 (sidecar), Supabase (DB + auth), Claude (LLM), Railway (Python), Vercel (Next.js).
```

#### 6. `apex-leads/README.md` (si no existe o es genérico)
Leer el actual con `cat apex-leads/README.md`. Si es el default de `create-next-app` o está vacío, reemplazar por:

```markdown
# apex-leads — Panel + WhatsApp agent

Next.js 14 (App Router) + TypeScript + Supabase + Claude + Wassenger.

## Desarrollo local

```bash
npm install
cp .env.local.example .env.local    # completar vars
npm run dev
```

## Variables de entorno

Ver `docs/ig/PROGRESS.md` sección "Vercel (Next.js)" para el listado canónico de env vars productivas. En local, mínimo:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `WASSENGER_API_KEY`
- Para desarrollo del módulo IG: `IG_SIDECAR_URL`, `IG_SIDECAR_SECRET`, `IG_SENDER_USERNAME`, `CRON_SECRET`, `APIFY_TOKEN`, `APIFY_WEBHOOK_SECRET`, `DRY_RUN=true`.

## Rutas principales

- `src/app/` — UI + API endpoints.
- `src/app/api/ig/` — endpoints del canal Instagram (webhook, run-cycle, cron).
- `src/app/api/webhooks/wassenger/` — inbound WhatsApp.
- `src/lib/ig/config.ts` — validación fail-fast de env vars del módulo IG.

## Tests

```bash
npm test
```

## Deploy

Vercel lee desde el monorepo con Root Directory = `apex-leads/`.
```

Si ya existe un README bueno, **no reemplazar** — en ese caso dejarlo.

#### 7. `sidecar/README.md`
```markdown
# ig-sidecar — Instagram automation service

FastAPI + instagrapi. Expone endpoints HTTP firmados con HMAC para que el panel (Next.js) pueda interactuar con Instagram sin usar la Graph API oficial.

## Desarrollo local

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt
cp .env.local.example .env.local    # completar
.venv/Scripts/python -m uvicorn app.main:app --port 8000
```

## Variables de entorno

Ver `docs/ig/PROGRESS.md` sección "Railway — ig-sidecar" para el listado productivo. En local:

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
```

#### 8. `docs/ARCHITECTURE.md`
```markdown
# Arquitectura — agente-busca-clientes

## Visión general

Dos canales de prospección (WhatsApp + Instagram) con un panel unificado. Un bot de conversación por Claude. Datos compartidos en Supabase.

## Diagrama

```
                        ┌──────────────────────────┐
                        │  Supabase (hpbxscfbnhs…) │
                        │  auth · storage · pg     │
                        └──────────┬───────────────┘
                                   │
            ┌──────────────────────┼──────────────────────┐
            │                      │                      │
    ┌───────▼────────┐     ┌───────▼────────┐     ┌───────▼────────┐
    │ apex-leads     │     │ ig-sidecar     │     │ ig-scheduler   │
    │ (Vercel)       │     │ (Railway)      │     │ (Railway cron) │
    │ Next.js 14     │     │ FastAPI        │     │ httpx trigger  │
    │                │     │ instagrapi     │     │                │
    └──────┬─────────┘     └──────┬─────────┘     └──────┬─────────┘
           │                      │                      │
           │  HMAC-signed HTTP    │                      │
           └──────────────────────┘                      │
           ▲                                             │
           │  Bearer CRON_SECRET                         │
           └─────────────────────────────────────────────┘

    ┌──────────┐     ┌──────────┐     ┌──────────┐
    │Wassenger │     │ Instagram│     │  Apify   │
    │  (WA)    │     │ (unoffic)│     │(discovery│
    └────┬─────┘     └────┬─────┘     └────┬─────┘
         │                │                 │
         └───► apex-leads │                 │
                          │                 │
                  ig-sidecar        ─►  apex-leads (webhook)
```

## Servicios

### apex-leads (Vercel)
- Panel web (dashboard, inbox, admin).
- API routes para WhatsApp inbound (Wassenger webhook) e Instagram (`/api/ig/*`).
- Agente Claude que responde conversaciones en ambos canales.
- Cron endpoints consumidos por Vercel Cron + Railway scheduler externo.

### sidecar (Railway)
- Wrapper HTTP sobre instagrapi.
- Sesión Instagram persistida en volumen `/data`.
- Circuit breaker contra errores de IG.
- HMAC obligatorio en todos los endpoints excepto `/health`.

### scheduler (Railway cron)
- Ejecución diaria a las 12:00 UTC.
- Pegamenta: dispara `POST /api/ig/run-cycle` en el panel.
- Runtime mínimo (`httpx` + 3 env vars).

## Flujos críticos

### Lead IG outbound
1. Scheduler dispara `/api/ig/run-cycle`.
2. Panel orquesta: obtiene leads pendientes (Supabase) → llama `sidecar /profile/enrich` → genera mensaje con Claude → llama `sidecar /dm/send`.
3. Resultado se logea en `ig_actions` (Supabase).

### Lead WA inbound
1. Usuario escribe al bot en WhatsApp.
2. Wassenger dispara webhook → `apex-leads/api/webhooks/wassenger`.
3. Agente Claude responde con contexto de DB.

### Circuit breaker
Si Instagram devuelve challenge o action block, el sidecar abre el circuit por N minutos. Durante ese tiempo responde 503 y el scheduler skippea.

## Contratos

- HTTP Next ↔ sidecar: [`docs/ig/SIDECAR-CONTRACT.md`](ig/SIDECAR-CONTRACT.md).
- Webhooks externos: Wassenger (WA), Apify (IG discovery).

## Reglas de cambio

- Cambios de contrato HTTP sidecar ↔ panel → versionar en `SIDECAR-CONTRACT.md` + migración coordinada.
- Cambios de schema Supabase → migración via MCP de Supabase + nota en `docs/ig/PROGRESS.md`.
- Env vars nuevas → documentar en el README del servicio afectado + en `docs/ig/PROGRESS.md`.
```

#### 9. Commit atómico de hygiene
```bash
git add README.md .gitignore .editorconfig docs/ARCHITECTURE.md apex-leads/README.md sidecar/README.md
git add -u    # para registrar la eliminación de scheduler/ y apex-leads.zip si correspondía
git status
git commit -m "docs(monorepo): add root README, ARCHITECTURE, per-service READMEs, unified gitignore"
```

Si se eliminó `scheduler/` duplicado, debería aparecer como `deleted:` en el diff. Si `apex-leads.zip` estaba trackeado, también.

#### 10. Actualizar `docs/migration/PROGRESS.md`
- Marcar SESSION-MIG-03 como `[x]`.
- Decisiones tomadas:
  - Estado del zip (en history sí/no).
  - `scheduler/` root eliminado (sí/no, con diff verificado).
  - Estructura de docs final.
- Si el zip estaba en history, agregar bloqueo: "SESSION-MIG-03b pendiente — limpieza de `apex-leads.zip` con `git filter-repo`".

Commit:
```bash
git add docs/migration/PROGRESS.md
git commit -m "docs(migration): session-03 monorepo hygiene complete"
git push origin master
```

### Fuera de scope
- Renombrar repo GitHub (SESSION-MIG-04).
- Reconfigurar Railway/Vercel (SESSION-MIG-04).
- Archive repo viejo (SESSION-MIG-05).
- `git filter-repo` del zip (sesión extra si aplica).

## Definición de "terminado"

- [ ] `README.md` root existe y tiene estructura correcta.
- [ ] `.gitignore` unificado en root cubre Node + Python + secretos IG.
- [ ] `.editorconfig` en root.
- [ ] `docs/ARCHITECTURE.md` con diagrama y descripciones.
- [ ] `apex-leads/README.md` útil (no default de Next).
- [ ] `sidecar/README.md` útil.
- [ ] `apex-leads.zip` eliminado del working directory.
- [ ] `scheduler/` root eliminado (si era duplicado).
- [ ] `git status` clean.
- [ ] `git push origin master` exitoso.
- [ ] `PROGRESS.md` actualizado.

## Al terminar la sesión

Mensaje a Manuel:
1. 3–5 bullets de lo hecho.
2. Estado del zip (trackeado en history sí/no) — si sí, flaggear SESSION-MIG-03b.
3. Comando:
   ```
   Nueva sesión → /model claude-sonnet-4-6 → pegar docs/migration/prompts/SESSION-MIG-04.md
   ```

## Reglas generales

1. No tocar lógica de servicios (app/src/).
2. No `--force push`.
3. Commits atómicos con prefijo `docs(monorepo):` o `chore(monorepo):`.
4. Documentación clara, precisa, sin inventar features que no existen.
