# MASTER-PLAN — Consolidación Monorepo `agente-busca-clientes`

> **Documento autoritativo.** Define el trayecto completo para unificar `apex-leads` + `ig-sidecar` en un único monorepo con arquitectura limpia y escalable.
> **No editar** salvo erratas. Las decisiones operativas se registran en `PROGRESS.md`.

---

## 1. Contexto y problema

### Estado actual (roto)
```
agente_busca_clientes/              ← repo: github.com/manu-180/ig-sidecar (master)
├── apex-leads/                     ← NESTED repo: github.com/manu-180/apex-leads (main)
│                                     ⚠️ gitlink mode 160000 sin .gitmodules = submodule roto
├── sidecar/                        ← parte de ig-sidecar (FastAPI + instagrapi)
├── scheduler/                      ← duplicado root (debe ser sidecar/scheduler/)
├── apex-leads.zip                  ← 163 MB, NO debe estar ni en disco ni en git
├── docs/                           ← parte de ig-sidecar
└── .remember/                      ← local, ignorar
```

**Síntomas:**
- `git status` en root muestra `modified: apex-leads (new commits)` permanentemente.
- Manuel tiene que hacer `git push` en dos repos distintos para un mismo producto.
- El panel (Next.js) y el worker (Python) comparten el mismo Supabase, las mismas tablas, el mismo dominio de negocio — pero viven separados.
- Hay un `scheduler/` duplicado en root y en `sidecar/scheduler/`.

### Objetivo
Un único monorepo `agente-busca-clientes` que contenga los dos servicios con arquitectura limpia, historial preservado, deployments intactos y ergonomía de solo-dev.

---

## 2. Principios rectores

1. **Un producto, un repo.** Manuel es solo-dev; no hay razón organizacional para repos separados.
2. **Preservar historial.** Los commits de ambos repos deben sobrevivir (via `git subtree`).
3. **Cero downtime en producción.** Railway (sidecar + scheduler) y Vercel (apex-leads) no pueden caer durante la migración.
4. **Arquitectura limpia por servicio, no a nivel monorepo.** No introducir turborepo/nx todavía — overhead sin beneficio con 2 servicios. Cada servicio mantiene su propia estructura interna limpia.
5. **Servicios acoplados por HTTP contract, no por código compartido.** El contrato está en `docs/ig/SIDECAR-CONTRACT.md`. Si en el futuro hace falta tipos compartidos, se evalúa `packages/shared` (no ahora).
6. **Fail-fast en boot.** Cada servicio valida su config al arrancar (ya es el caso).
7. **Sesiones limpias.** Una sesión de Claude Code = un objetivo cerrado + handoff escrito.

---

## 3. Estructura final objetivo

```
agente-busca-clientes/                  ← github.com/manu-180/agente-busca-clientes (master)
│
├── apex-leads/                         ← Servicio 1: Next.js 14 + Supabase + Claude
│   ├── src/
│   │   ├── app/                        ← rutas (UI + API)
│   │   ├── components/                 ← React components
│   │   ├── lib/                        ← prompts, supabase clients, ig config
│   │   └── types/
│   ├── scripts/                        ← generación de datos, utilidades
│   ├── __tests__/
│   ├── package.json
│   ├── next.config.js
│   ├── .env.local.example
│   └── README.md                       ← cómo correr este servicio
│
├── sidecar/                            ← Servicio 2: Python FastAPI + instagrapi
│   ├── app/
│   │   ├── routes/                     ← endpoints HTTP
│   │   ├── ig_client.py                ← wrapper instagrapi
│   │   ├── session_store.py            ← persistencia de sesión IG
│   │   ├── circuit_breaker.py          ← resiliencia
│   │   └── auth.py                     ← middleware HMAC
│   ├── scheduler/                      ← Servicio 3: Python cron (Railway)
│   │   ├── scheduler.py
│   │   ├── Dockerfile
│   │   └── railway.toml
│   ├── tests/
│   ├── tools/                          ← scripts de bootstrap (login local, etc.)
│   ├── Dockerfile
│   ├── railway.toml
│   ├── requirements.txt
│   ├── .env.local.example
│   └── README.md                       ← cómo correr este servicio
│
├── docs/                               ← Documentación unificada
│   ├── README.md                       ← índice
│   ├── ARCHITECTURE.md                 ← diagrama de servicios + contrato HTTP
│   ├── ig/                             ← docs del proyecto IG (existentes)
│   │   ├── MASTER-PLAN.md
│   │   ├── PROGRESS.md
│   │   ├── SIDECAR-CONTRACT.md
│   │   └── prompts/                    ← SESSION-XX.md del proyecto IG
│   ├── migration/                      ← ESTE plan
│   │   ├── MASTER-PLAN.md
│   │   ├── PROGRESS.md
│   │   └── prompts/
│   └── wpp/                            ← (futuro) docs del canal WhatsApp si crecen
│
├── .gitignore                          ← unificado, cubre Node + Python
├── .editorconfig                       ← estilo consistente
├── README.md                           ← orientación inicial del monorepo
└── CONTRIBUTING.md                     ← convenciones (commits, branches, PRs)
```

### Deployments asociados (sin cambios de URL)
- **Vercel** · proyecto `apex-leads` · root directory = `apex-leads/` · dominio público actual.
- **Railway** · servicio `ig-sidecar` · root directory = `sidecar/` · `https://ig-sidecar-production.up.railway.app`.
- **Railway** · servicio `ig-scheduler` · root directory = `sidecar/scheduler/` · cron `0 12 * * *`.

---

## 4. Estrategia de migración

### Preservación de historial
Se usa **`git subtree add`** para incorporar `apex-leads` al repo principal manteniendo todos sus commits. El repo `ig-sidecar` se **renombra** en GitHub a `agente-busca-clientes` (preserva su historial también). El repo `apex-leads` se **archiva** (read-only) una vez verificada la integridad.

```bash
# Resumen del flujo (detallado en SESSION-MIG-02)
git remote add apex-leads-origin https://github.com/manu-180/apex-leads.git
git fetch apex-leads-origin
git rm -rf --cached apex-leads           # quitar gitlink roto
git subtree add --prefix=apex-leads apex-leads-origin main --squash=false
```

### Orden de operaciones (crítico)
1. **Backup** — bundles locales de ambos repos antes de tocar nada.
2. **Sincronización** — commitear y pushear todos los cambios pendientes en ambos repos.
3. **Subtree merge** — unificar historial.
4. **Hygiene** — `.gitignore`, README root, limpieza de archivos grandes.
5. **Rename en GitHub** — `ig-sidecar` → `agente-busca-clientes`.
6. **Reconfigurar deployments** — verificar root dirs en Railway y Vercel.
7. **Smoke test end-to-end** — `/health`, build Vercel, cron Railway.
8. **Archive del repo viejo** — `apex-leads` en GitHub como read-only.

### Reglas de seguridad
- Nada destructivo sin backup + confirmación explícita.
- `git push --force` prohibido sobre `master`/`main` de cualquier repo.
- Antes de cualquier `git rm`, verificar con `git status` y `git diff`.
- Cada sesión commitea atómicamente y empuja a remoto antes de cerrar.

---

## 5. Plan de sesiones

### SESSION-MIG-01 — Pre-flight audit + backup + sincronización
**Modelo:** `claude-sonnet-4-6`
**Duración:** 30–45 min
**Objetivo único:** Dejar ambos repos en estado "todo commiteado y pusheado", con bundles de respaldo.

**Entregables:**
- Bundle `backup/ig-sidecar-<fecha>.bundle` (git bundle).
- Bundle `backup/apex-leads-<fecha>.bundle`.
- Ambos repos con `git status` limpio y `git log origin/HEAD..HEAD` vacío.
- Documento `docs/migration/PROGRESS.md` inicializado con inventario de:
  - URLs de deployments actuales.
  - Env vars críticas (ya están en `docs/ig/PROGRESS.md`, referenciarlas).
  - Commits HEAD de ambos repos pre-migración.
  - Lista de archivos grandes detectados (`apex-leads.zip`, etc.).

**Fuera de scope:** tocar `.gitmodules`, subtree merge, renombres.

---

### SESSION-MIG-02 — Subtree merge + cleanup del submodule roto
**Modelo:** `claude-opus-4-7`
**Duración:** 45–90 min
**Objetivo único:** `apex-leads/` pasa a ser un directorio regular del repo `ig-sidecar` (pronto `agente-busca-clientes`) con su historial preservado. Cero pérdida de commits.

**Entregables:**
- `apex-leads/.git/` eliminado (ya no es repo independiente).
- Gitlink 160000 reemplazado por el árbol de archivos reales en el índice del repo padre.
- `git log --all -- apex-leads/` muestra los commits históricos del repo apex-leads.
- Commit atómico: `chore(monorepo): merge apex-leads via git subtree preserving history`.
- Push a `origin/master` verificado.
- `PROGRESS.md` actualizado con el SHA pre/post merge.

**Fuera de scope:** renombrar repo en GitHub, tocar Railway/Vercel, limpieza del zip grande.

---

### SESSION-MIG-03 — Monorepo hygiene + limpieza de archivos pesados
**Modelo:** `claude-sonnet-4-6`
**Duración:** 30–60 min
**Objetivo único:** Monorepo con estructura profesional: `README.md` root, `.gitignore` unificado, `docs/ARCHITECTURE.md`, READMEs por servicio, sin archivos de 160 MB.

**Entregables:**
- `README.md` root con: qué es, árbol de servicios, cómo correr cada uno, links a docs.
- `.gitignore` unificado (cubre Node, Python, Docker, IDE, OS).
- `docs/ARCHITECTURE.md` con diagrama (ASCII o Mermaid) de: Vercel ↔ Railway sidecar ↔ Supabase ↔ Railway scheduler.
- `apex-leads/README.md` y `sidecar/README.md` con instrucciones de dev local.
- `apex-leads.zip` removido del working directory (y verificado que nunca entró al git history — si entró, usar `git filter-repo` en sesión separada).
- `scheduler/` root eliminado (duplicado de `sidecar/scheduler/`).
- `.editorconfig` con reglas básicas.
- Commit: `docs(monorepo): add root README, architecture, gitignore, per-service READMEs`.

**Fuera de scope:** renombre en GitHub, cambios de URL.

---

### SESSION-MIG-04 — Rename repo en GitHub + reconfigurar deployments
**Modelo:** `claude-sonnet-4-6`
**Duración:** 30–60 min
**Objetivo único:** El repo remoto se llama `agente-busca-clientes`, el remote local apunta ahí, y los 3 servicios (Vercel apex-leads, Railway sidecar, Railway scheduler) siguen deployando correctamente con root directories explícitos.

**Entregables:**
- Repo GitHub renombrado `ig-sidecar` → `agente-busca-clientes` (GitHub redirige el viejo nombre, pero actualizamos local igual).
- `git remote set-url origin https://github.com/manu-180/agente-busca-clientes.git`.
- Vercel · proyecto `apex-leads` · Settings → Git → repo apunta a `agente-busca-clientes` · Root Directory = `apex-leads`.
- Railway · servicio `ig-sidecar` · Settings → Source → repo + Root Directory = `sidecar`.
- Railway · servicio `ig-scheduler` · Settings → Source → repo + Root Directory = `sidecar/scheduler`.
- Smoke tests verdes:
  - `curl https://ig-sidecar-production.up.railway.app/health` → `status: ok`.
  - Build de Vercel completa sin errores post-reconfiguración.
  - Próximo cron de scheduler logea correctamente (o trigger manual).
- `PROGRESS.md` con checklist firmado.

**Fuera de scope:** cambios de código, archivo del repo viejo apex-leads.

---

### SESSION-MIG-05 — Archive repo viejo + verificación final + cierre
**Modelo:** `claude-sonnet-4-6`
**Duración:** 20–40 min
**Objetivo único:** El repo `apex-leads` queda archivado (read-only) en GitHub. Documentación final refleja el estado consolidado. La migración se da por cerrada.

**Entregables:**
- `github.com/manu-180/apex-leads` marcado como Archived.
- README del repo archivado con link al nuevo (`→ now part of agente-busca-clientes`).
- `docs/migration/PROGRESS.md` con sección "Post-migration checklist" completa.
- `docs/ig/PROGRESS.md` actualizado con nota: "A partir de 2026-MM-DD el proyecto vive en monorepo `agente-busca-clientes`".
- Verificación end-to-end final:
  - `POST /api/ig/run-cycle` en Vercel → `ok: true` (DRY_RUN).
  - Sidecar `/health` verde.
  - Scheduler última ejecución exitosa.
- Commit: `docs(migration): close monorepo consolidation, apex-leads archived`.
- Si todo verde: eliminar `backup/*.bundle` locales (o mover a carpeta externa).

**Fuera de scope:** nuevas features. La migración está cerrada.

---

## 6. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Pérdida de commits durante subtree merge | Baja | Alto | Bundle backup en SESSION-MIG-01, verificar `git log --all` antes de commitear. |
| Deployment Vercel cae al cambiar Root Directory | Media | Medio | Probar build en preview antes de promover, rollback via redeploy. |
| Railway pierde el volumen `/data` del sidecar | Muy baja | Alto | El volumen está atado al servicio, no al repo. Renombrar repo no afecta. Verificar antes de tocar. |
| `apex-leads.zip` ya está en git history (balloneando el repo) | Media | Medio | `git log --all --oneline -- apex-leads.zip` en MIG-03. Si está, sesión extra con `git filter-repo`. |
| Credenciales en git history | Desconocida | Alto | Scan con `gitleaks` en MIG-03. Si hay leaks, sesión extra de remediación. |
| Scheduler pierde el cron schedule al cambiar root dir | Baja | Bajo | `railway.toml` está versionado, Railway lo re-lee al deploy. Trigger manual post-migración. |

---

## 7. Reglas generales (TODA sesión de este plan)

1. **Leer primero** `docs/migration/MASTER-PLAN.md` + `docs/migration/PROGRESS.md`. No asumir nada.
2. **Commits atómicos** con prefijos: `chore(monorepo):`, `docs(monorepo):`, `fix(monorepo):`.
3. **No `--force` push** sobre `master`/`main` bajo ninguna circunstancia (salvo aprobación explícita escrita).
4. **No tocar** el proyecto IG funcional (`docs/ig/`, `sidecar/app/`, `apex-leads/src/`) salvo lo que este plan indique.
5. **Actualizar PROGRESS.md** al final de cada sesión con: SHAs clave, decisiones, bloqueos.
6. **Escribir el SESSION-MIG-(XX+1).md** si aplica (sesiones ya están definidas acá — si surge algo nuevo, documentarlo como suplemento).
7. **Smoke tests antes de cerrar sesión.** Si algo rompió en prod, rollback y parar.
8. **No emojis en código ni docs** (en conversación sí).

---

## 8. Definición de "migración completa"

- [ ] Un solo repo GitHub: `github.com/manu-180/agente-busca-clientes`.
- [ ] `apex-leads/` es un directorio regular con historial preservado (`git log -- apex-leads/` muestra commits de ambos orígenes).
- [ ] Vercel deploya desde `apex-leads/` root — URL original intacta.
- [ ] Railway sidecar deploya desde `sidecar/` — URL `https://ig-sidecar-production.up.railway.app` intacta.
- [ ] Railway scheduler deploya desde `sidecar/scheduler/` — próximo cron a las 12:00 UTC corre OK.
- [ ] Repo viejo `apex-leads` archivado en GitHub con README redirigiendo.
- [ ] Documentación actualizada (ARCHITECTURE.md, READMEs por servicio, PROGRESS.md firmado).
- [ ] Backups locales eliminados (o archivados fuera del repo).

---

## 9. Referencias

- Estado actual: `git status`, `git ls-tree HEAD`, este doc.
- Proyecto IG (no se toca): `docs/ig/MASTER-PLAN.md`, `docs/ig/PROGRESS.md`.
- Contrato HTTP sidecar ↔ Next: `docs/ig/SIDECAR-CONTRACT.md`.
- Env vars canónicas: `docs/ig/PROGRESS.md` sección "Variables de entorno capturadas".
