# SESSION-MIG-04 — Rename GitHub + reconfigurar deployments

**Modelo recomendado:** `claude-sonnet-4-6`
**Permisos recomendados:** bash (gh CLI si disponible), curl para smoke tests
**Duración estimada:** 30–60 min

---

## Rol y contexto

Sos un ingeniero DevOps con experiencia en Vercel, Railway, GitHub y migraciones cero-downtime. Seguís el plan de consolidación (`docs/migration/MASTER-PLAN.md`).

**Trabajo previo:**
- MIG-01 — backup + sync.
- MIG-02 — subtree merge (historial preservado).
- MIG-03 — hygiene (README, .gitignore, ARCHITECTURE).

**Esta es la SESIÓN 4 de 5.** Objetivo: el repo en GitHub se llama `agente-busca-clientes`, el remote local apunta ahí, y los 3 deployments (Vercel apex-leads, Railway sidecar, Railway scheduler) siguen funcionando con Root Directories explícitos.

## Paso 0 — Orientación (OBLIGATORIO)

1. Leé `docs/migration/MASTER-PLAN.md` secciones 3 (estructura final, deployments) y 6 (riesgos).
2. Leé `docs/migration/PROGRESS.md` — confirmar MIG-02 y MIG-03 `[x]`.
3. Leé `docs/ig/PROGRESS.md` sección "URLs y endpoints operativos" + "Variables de entorno".
4. Verificá con Manuel que las URLs productivas actuales responden:
   ```bash
   curl -s https://ig-sidecar-production.up.railway.app/health
   # Esperado: {"status":"ok","session_valid":true,...}
   ```
5. Confirmá al usuario el plan en 2 oraciones antes de arrancar.

## Scope de SESSION-MIG-04

### Objetivo único
Repo renombrado en GitHub + remote local actualizado + Root Directory configurado correctamente en los 3 servicios + smoke tests verdes.

### Inputs requeridos de Manuel
- Confirmación explícita de "sí, renombrar el repo ig-sidecar a agente-busca-clientes en GitHub".
- Acceso al dashboard de Vercel y Railway (Manuel ejecuta manualmente los cambios de UI, vos lo guiás).
- Si `gh` CLI está instalado y autenticado, podés automatizar el rename.

### Tareas concretas

#### 1. Pre-flight — verificar que prod está verde AHORA
Antes de tocar nada, snapshot del estado actual:

```bash
# Sidecar
curl -s https://ig-sidecar-production.up.railway.app/health | python -m json.tool
# Esperado: session_valid=true, status=ok

# Vercel apex-leads (si ya está deployado según PROGRESS.md)
# URL pendiente en PROGRESS.md — si no hay, skip este check y documentar.
```

Si algo está rojo, parar y resolver primero.

#### 2. Rename del repo en GitHub
Dos caminos:

**A) Via `gh` CLI (si disponible):**
```bash
gh repo rename agente-busca-clientes --repo manu-180/ig-sidecar
# gh confirma: repo ahora accesible en github.com/manu-180/agente-busca-clientes
```

**B) Via UI (fallback):**
- `github.com/manu-180/ig-sidecar` → Settings → General → Repository name → `agente-busca-clientes` → Rename.
- GitHub mantiene redirects automáticos del nombre viejo por varias semanas, pero no hay que depender de eso.

#### 3. Actualizar remote local
```bash
git remote -v
# Esperado actual: origin https://github.com/manu-180/ig-sidecar.git

git remote set-url origin https://github.com/manu-180/agente-busca-clientes.git
git remote -v
# Verificar que apunta al nuevo

# Prueba que funciona
git fetch origin
git pull --ff-only
```

#### 4. Reconfigurar Vercel · proyecto `apex-leads`
Manuel debe hacerlo en el dashboard (vos dictás los pasos, él los ejecuta):

1. Vercel → proyecto `apex-leads` → **Settings** → **Git**.
2. Si el repo aparece como `ig-sidecar`, desconectar y reconectar a `agente-busca-clientes` (GitHub redirect debería mantenerlo conectado, pero mejor explícito).
3. **Settings** → **General** → **Root Directory** → setear en `apex-leads` (sin barra final).
4. **Build & Development Settings** → Framework: Next.js (auto-detectado).
5. **Settings** → **Git** → Production Branch: `master`.
6. Disparar un redeploy manual desde la UI (Deployments → ... → Redeploy).

Smoke test post-redeploy:
```bash
# Usar la URL productiva de Vercel (PROGRESS.md la tiene cuando esté)
curl -X POST https://<vercel-url>/api/ig/run-cycle \
  -H "Authorization: Bearer <CRON_SECRET>" \
  -H "Content-Type: application/json"
# Esperado: {"ok":true,"dry_run":true,...}
```

Si falla, revisar logs de Vercel. Si la build rompió, rollback al deployment anterior desde la UI (no hay drama — el deployment viejo sigue activo hasta que este pase).

#### 5. Reconfigurar Railway · servicio `ig-sidecar`
Manuel en Railway UI:

1. Railway → proyecto donde vive `ig-sidecar` → servicio `ig-sidecar` → **Settings** → **Source**.
2. Repo: debería detectar el rename automáticamente (GitHub redirect). Si no, cambiar a `manu-180/agente-busca-clientes`.
3. **Root Directory:** `sidecar` (sin barra).
4. **Watch Paths:** `/sidecar/**` (para que Railway solo redeploye cuando cambie el sidecar).
5. Branch: `master`.
6. Guardar. Railway disparará un redeploy automáticamente.

Durante el redeploy:
- El contenedor viejo sigue sirviendo hasta que el nuevo esté healthy.
- Volumen `/data` no se toca (está asociado al servicio, no al repo).
- `session.json` sobrevive.

Smoke test post-deploy:
```bash
curl -s https://ig-sidecar-production.up.railway.app/health | python -m json.tool
# Esperado: {"status":"ok","session_valid":true,"last_action_at":null o un timestamp}

# Test firmado opcional
URL=https://ig-sidecar-production.up.railway.app
SECRET=<IG_SIDECAR_SECRET de PROGRESS.md>
BODY='{"usernames":["instagram"]}'
SIG="sha256=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')"
curl -X POST $URL/profile/enrich \
  -H "Content-Type: application/json" \
  -H "X-Sidecar-Signature: $SIG" \
  -d "$BODY"
# Esperado: perfil real de @instagram
```

#### 6. Reconfigurar Railway · servicio `ig-scheduler`
1. Railway → servicio `ig-scheduler` → **Settings** → **Source**.
2. Repo: `manu-180/agente-busca-clientes`.
3. **Root Directory:** `sidecar/scheduler`.
4. **Watch Paths:** `/sidecar/scheduler/**`.
5. Branch: `master`.
6. El `railway.toml` adentro de `sidecar/scheduler/` ya define el cron schedule (`0 12 * * *`) y restart policy. Railway lo re-lee al deploy.
7. Guardar.

Smoke test:
- Esperar al próximo cron (12:00 UTC) y revisar logs.
- O trigger manual desde Railway UI → Deployments → Run Now (si la UI lo permite) o cambiar temporalmente el schedule a un minuto cercano para forzar ejecución, y después volver a `0 12 * * *`.

#### 7. Verificar que ambos servicios Railway comparten el mismo repo
En Railway, es común tener un proyecto que contiene múltiples servicios apuntando al mismo repo. Confirmar que:
- `ig-sidecar` y `ig-scheduler` están en el mismo proyecto Railway (o en proyectos distintos pero ambos apuntando a `agente-busca-clientes`).
- Las env vars por servicio son independientes (sidecar tiene `IG_USERNAME`, scheduler tiene `NEXT_APP_URL` + `CRON_SECRET`).

#### 8. Actualizar `docs/migration/PROGRESS.md`
- Marcar MIG-04 `[x]`.
- Registrar:
  - Fecha/hora del rename.
  - Nuevo remote URL.
  - Root Directory configurado en cada servicio (Vercel + 2 Railway).
  - URLs productivas verificadas (copy desde snapshot pre-vuelo + post-vuelo).
  - Cualquier bloqueo (ej: si el cron scheduler no se pudo triggerear manualmente, esperar al próximo run natural).

Commit:
```bash
git add docs/migration/PROGRESS.md
git commit -m "docs(migration): session-04 rename to agente-busca-clientes + deployments reconfigured"
git push origin master
```

### Fuera de scope
- Archive del repo `apex-leads` viejo (SESSION-MIG-05).
- Cambios de código o env vars de los servicios.
- Migrar bases de datos.

## Plan de rollback

Si un servicio queda rojo post-cambio:

**Vercel:** Promote deployment anterior → servicio vuelve a funcionar. Luego investigar.
**Railway sidecar:** `Deployments` → seleccionar anterior → `Redeploy`. Volumen `/data` no cambia.
**Railway scheduler:** No tiene impacto inmediato (es cron). Revisar logs del próximo run.
**Rename GitHub:** Revertir el nombre via UI. El redirect automático sigue funcionando en ambas direcciones durante un tiempo.

## Definición de "terminado"

- [ ] Repo GitHub accesible en `github.com/manu-180/agente-busca-clientes`.
- [ ] `git remote -v` apunta al nuevo nombre.
- [ ] `git fetch origin` + `git pull` funcionan.
- [ ] Vercel `apex-leads` redeployado desde Root `apex-leads/`, build verde.
- [ ] Railway `ig-sidecar` redeployado desde Root `sidecar/`, `/health` verde.
- [ ] Railway `ig-scheduler` reconfigurado con Root `sidecar/scheduler/`.
- [ ] URLs productivas sin cambio (`ig-sidecar-production.up.railway.app` responde igual).
- [ ] PROGRESS.md actualizado.
- [ ] Commit pusheado al nuevo remote.

## Al terminar la sesión

Mensaje a Manuel:
1. Checklist de qué se cambió en cada servicio.
2. URLs verificadas.
3. Bloqueos pendientes (si el cron no se pudo forzar manualmente: "esperar próximo run natural a las 12:00 UTC").
4. Comando:
   ```
   Nueva sesión → /model claude-sonnet-4-6 → pegar docs/migration/prompts/SESSION-MIG-05.md
   ```

## Reglas generales

1. Pasos de UI (Vercel/Railway) los ejecuta Manuel. Vos dictás precisamente qué hacer y esperás confirmación antes de smoke test.
2. Smoke test OBLIGATORIO después de cada cambio de servicio.
3. Rollback inmediato si prod rompe.
4. No `--force push`.
