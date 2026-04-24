# SESSION-MIG-01 — Pre-flight audit + backup + sincronización

**Modelo recomendado:** `claude-sonnet-4-6`
**Permisos recomendados:** bash (git, git bundle)
**Duración estimada:** 30–45 min

---

## Rol y contexto

Sos un ingeniero DevOps senior con experiencia en migraciones de repositorios Git y en operaciones cero-downtime. Trabajás para Manuel (solopreneur) en el proyecto `agente-busca-clientes`: un producto único que hoy vive dividido entre dos repos GitHub (`apex-leads` + `ig-sidecar`), ambos clonados en la misma carpeta local `C:\MisProyectos\bots_ia\agente_busca_clientes` con `apex-leads/` anidado dentro de `ig-sidecar/` como submodule roto.

**Decisión estratégica ya tomada** (documentada en `docs/migration/MASTER-PLAN.md`): consolidar en un único monorepo llamado `agente-busca-clientes`, preservando historial de ambos repos vía `git subtree`.

**Esta es la SESIÓN 1 de 5.** Acá todavía **no se toca nada destructivo**. El objetivo es dejar el terreno listo: todo commiteado, todo pusheado, backups hechos, inventario documentado.

## Paso 0 — Orientación (OBLIGATORIO)

Antes de ejecutar acciones:

1. Leé `docs/migration/MASTER-PLAN.md` completo — especialmente secciones 3 (estructura objetivo), 4 (estrategia), 5 (plan de sesiones), 6 (riesgos).
2. Leé `docs/migration/PROGRESS.md` (está vacío, lo vas a llenar vos).
3. Leé `docs/ig/PROGRESS.md` sección "Variables de entorno capturadas" y "URLs y endpoints operativos" — esto es información crítica que NO debe perderse.
4. Corré `git status` en root y también en `apex-leads/` para ver el estado de ambos repos.
5. Confirmá al usuario en 1–2 oraciones qué vas a hacer antes de empezar.

## Scope de SESSION-MIG-01

### Objetivo único
Dejar ambos repos en estado "todo commiteado, todo pusheado, bundles de respaldo creados, inventario escrito en PROGRESS.md".

### Tareas concretas

#### 1. Inventario inicial
Corré y registrá en memoria (los vas a escribir en PROGRESS.md al final):
```bash
# Desde root del monorepo (ig-sidecar repo)
git remote -v
git rev-parse HEAD
git status --short
git log origin/master..HEAD --oneline    # commits locales sin pushear

# Desde apex-leads/
cd apex-leads
git remote -v
git rev-parse HEAD
git status --short
git log origin/main..HEAD --oneline
cd ..
```

También listá archivos grandes (>10 MB) que podrían ser problema:
```bash
# En bash (cualquier shell unix-like)
find . -type f -size +10M -not -path "*/node_modules/*" -not -path "*/.next/*" -not -path "*/.venv/*" -not -path "*/.git/*" 2>/dev/null
```

Especial atención a `apex-leads.zip` (163 MB en root).

#### 2. Sincronizar `ig-sidecar` (repo padre)
`git status` muestra modificaciones locales. Revisar cada archivo:
```bash
git diff sidecar/app/session_store.py
git diff sidecar/railway.toml
git diff sidecar/requirements.txt
git diff docs/ig/PROGRESS.md
git status --short
```

Los untracked relevantes:
- `docs/ig/prompts/SESSION-06.md` a `SESSION-11.md`
- `sidecar/.gitignore`
- `sidecar/scheduler/`
- `sidecar/session_b64.txt` ⚠️ **posible secreto** — verificar contenido antes de commitear
- `sidecar/session_export.json` ⚠️ **posible secreto** — verificar
- `sidecar/tools/`

**Regla:** los archivos `session_b64.txt` y `session_export.json` son artefactos del bootstrap del sidecar y **contienen cookies de sesión de Instagram**. NO deben entrar al repo. Agregar al `.gitignore` del sidecar y dejar fuera del commit.

Commitear lo que sí corresponde con mensaje claro:
```bash
# Ejemplo de commit atómico — ajustar según el estado real
git add docs/ig/prompts/ docs/ig/PROGRESS.md sidecar/.gitignore sidecar/scheduler/ sidecar/tools/ sidecar/app/ sidecar/railway.toml sidecar/requirements.txt
git commit -m "chore(ig): sync pending session-05/06 work before monorepo consolidation"
```

Si hay dudas sobre algún archivo, consultar a Manuel antes de commitear.

Pushear:
```bash
git push origin master
```

#### 3. Sincronizar `apex-leads` (repo anidado)
Desde `apex-leads/`:
```bash
cd apex-leads
git status --short
git diff    # revisar cambios locales
```

Si hay cambios, commitear con mensaje descriptivo (prefijo acorde al proyecto IG existente: `feat(ig):`, `fix:`, etc.).

Pushear:
```bash
git push origin main
cd ..
```

#### 4. Crear bundles de respaldo
Los bundles son snapshots completos del repo (todas las ramas, todos los commits). Son la red de seguridad contra un subtree merge que salga mal.

```bash
# Desde root del monorepo
mkdir -p backup

# Bundle del repo padre (ig-sidecar)
git bundle create backup/ig-sidecar-$(date +%Y%m%d).bundle --all

# Bundle del repo apex-leads
cd apex-leads
git bundle create ../backup/apex-leads-$(date +%Y%m%d).bundle --all
cd ..

# Verificar integridad
git bundle verify backup/ig-sidecar-$(date +%Y%m%d).bundle
git -C apex-leads bundle verify ../backup/apex-leads-$(date +%Y%m%d).bundle

ls -lh backup/
```

Agregá `backup/` al `.gitignore` del repo padre (no queremos commitear los bundles).

#### 5. Verificación final de estado limpio
```bash
# Ambos repos deben mostrar "nothing to commit, working tree clean"
git status
cd apex-leads && git status && cd ..

# Ambos deben mostrar que origin/HEAD == HEAD (sin commits locales sin pushear)
git log origin/master..HEAD --oneline    # debe estar vacío
git -C apex-leads log origin/main..HEAD --oneline    # debe estar vacío
```

#### 6. Llenar `docs/migration/PROGRESS.md`
Completar las secciones marcadas `_pending_`:

- **ig-sidecar HEAD:** SHA completo del commit HEAD del repo padre.
- **apex-leads HEAD:** SHA completo del commit HEAD del repo anidado.
- **Fecha de arranque:** `2026-MM-DD`.
- **Bundles de respaldo:** paths completos + tamaño de cada uno.
- Agregar sección "Inventario pre-migración":
  - Lista de archivos grandes detectados.
  - Confirmación de que `session_b64.txt` y `session_export.json` están en `.gitignore`.
  - Remote URLs originales.
- Marcar SESSION-MIG-01 como `[x]` en el listado.

#### 7. Commit final del inventario
```bash
git add docs/migration/PROGRESS.md sidecar/.gitignore .gitignore
git commit -m "docs(migration): session-01 pre-flight audit + backup + inventory"
git push origin master
```

### Fuera de scope (NO hacer en esta sesión)
- Subtree merge (SESSION-MIG-02).
- Tocar el gitlink `apex-leads`.
- Renombrar el repo en GitHub.
- Borrar el zip grande.
- Modificar Railway/Vercel.
- Crear READMEs nuevos.

## Definición de "terminado"

- [ ] `git status` en root = clean.
- [ ] `git status` en `apex-leads/` = clean.
- [ ] Ambos repos pusheados (ningún commit local sin origen).
- [ ] `backup/ig-sidecar-<fecha>.bundle` existe y verifica OK.
- [ ] `backup/apex-leads-<fecha>.bundle` existe y verifica OK.
- [ ] `backup/` está en `.gitignore` del repo padre.
- [ ] `session_b64.txt` y `session_export.json` en `.gitignore` del sidecar.
- [ ] `docs/migration/PROGRESS.md` actualizado con SHAs, bundles, inventario.
- [ ] Commit `docs(migration): session-01 pre-flight audit + backup + inventory` pusheado.

## Al terminar la sesión

Confirmá al usuario:
1. Resumen en 3–5 bullets de lo hecho.
2. Inputs pendientes (si hay) para SESSION-MIG-02.
3. Comando exacto para la próxima sesión:
   ```
   Nueva sesión Claude Code → /model claude-opus-4-7 → pegar contenido de docs/migration/prompts/SESSION-MIG-02.md
   ```

## Reglas generales

1. Leer `MASTER-PLAN.md` y `PROGRESS.md` de migración antes de tocar nada.
2. Commits atómicos con prefijo `chore(migration):` o `docs(migration):`.
3. Nunca `--force push`.
4. No tocar código del proyecto IG funcional.
5. Ante duda, parar y preguntar a Manuel.
