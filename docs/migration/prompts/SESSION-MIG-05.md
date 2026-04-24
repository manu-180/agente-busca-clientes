# SESSION-MIG-05 — Archive repo viejo + verificación final + cierre

**Modelo recomendado:** `claude-sonnet-4-6`
**Permisos recomendados:** bash, gh CLI opcional, curl
**Duración estimada:** 20–40 min

---

## Rol y contexto

Sos un ingeniero senior cerrando una migración. Seguís el plan (`docs/migration/MASTER-PLAN.md`).

**Trabajo previo:**
- MIG-01 a MIG-04 completos. El monorepo `agente-busca-clientes` está operativo en prod.

**Esta es la SESIÓN 5 de 5 — la última.** Objetivo: archivar el repo `apex-leads` viejo en GitHub, correr la verificación E2E final, actualizar docs y cerrar oficialmente la migración.

## Paso 0 — Orientación (OBLIGATORIO)

1. Leé `docs/migration/MASTER-PLAN.md` secciones 5 (SESSION-MIG-05) y 8 (definición de migración completa).
2. Leé `docs/migration/PROGRESS.md` — confirmar que MIG-01 a MIG-04 tienen `[x]`.
3. Verificá que prod sigue verde (sidecar `/health` + Vercel + scheduler si aplica).
4. Confirmá al usuario el plan en 1 oración antes de arrancar.

## Scope de SESSION-MIG-05

### Objetivo único
Repo `apex-leads` archivado + verificación E2E de los 3 servicios + docs finales + cierre oficial de la migración.

### Tareas concretas

#### 1. Verificación E2E pre-archivo
Antes de archivar nada, confirmar que todo funciona:

```bash
# Sidecar
curl -s https://ig-sidecar-production.up.railway.app/health | python -m json.tool

# Vercel apex-leads (URL productiva — si está en PROGRESS.md)
curl -X POST https://<vercel-url>/api/ig/run-cycle \
  -H "Authorization: Bearer <CRON_SECRET>" \
  -H "Content-Type: application/json"
# Esperado: {"ok":true,"dry_run":true,...}

# Scheduler — revisar últimos logs en Railway UI
# Manuel confirma que la última corrida (≤24h) fue exitosa.
```

Si algo está rojo: parar, investigar, NO archivar.

#### 2. Preparar README del repo archivado
En `apex-leads` viejo (aún accesible en GitHub), crear un commit final con un README que redirija:

```markdown
# apex-leads — ARCHIVED

This repository has been consolidated into the monorepo:

**→ https://github.com/manu-180/agente-busca-clientes**

The complete history of this repo was merged into the monorepo preserving all individual commits (via `git subtree merge`).

Archived on YYYY-MM-DD.
```

Manuel lo hace manualmente en GitHub (UI → edit README.md → commit to main). O via `gh`:

```bash
# En un clone temporal del repo viejo (fuera del monorepo)
cd /tmp
git clone https://github.com/manu-180/apex-leads.git apex-leads-archive
cd apex-leads-archive
# Reemplazar README.md con el contenido de archive
# ...
git add README.md
git commit -m "docs: archive notice — project moved to agente-busca-clientes monorepo"
git push origin main
cd -
```

#### 3. Archive del repo en GitHub
**Via `gh` CLI:**
```bash
gh repo archive manu-180/apex-leads --yes
```

**Via UI:**
- `github.com/manu-180/apex-leads` → Settings → General → scroll hasta "Danger Zone" → **Archive this repository** → confirmar tipeando el nombre.

Resultado: repo queda read-only. URLs siguen funcionando (lectura). No se pueden pushear commits, no se pueden abrir issues, etc. Esto es lo que queremos.

#### 4. Actualizar `docs/ig/PROGRESS.md` con nota de migración
Agregar al tope del archivo, debajo del título:

```markdown
> **Nota (YYYY-MM-DD):** A partir de esta fecha el proyecto vive en el monorepo `agente-busca-clientes`. El repo `apex-leads` fue archivado en GitHub. La estructura interna (`apex-leads/src/`, `sidecar/`, etc.) y las URLs productivas no cambiaron. Detalles en `docs/migration/`.
```

#### 5. Completar el checklist final en `docs/migration/PROGRESS.md`

```markdown
## Post-migration checklist

- [x] Repo único: `agente-busca-clientes`.
- [x] Vercel build verde desde root `apex-leads/`.
- [x] Sidecar `/health` verde.
- [x] Scheduler última run exitosa (timestamp: YYYY-MM-DD HH:MM UTC).
- [x] Repo `apex-leads` archivado en GitHub.
- [x] Docs finales actualizadas.
- [ ] Backups movidos fuera del repo.   ← pendiente manual de Manuel
```

#### 6. Limpieza de backups
Los bundles en `backup/` son valiosos pero voluminosos. Dos opciones:

**A) Mover a almacenamiento externo:**
```bash
# Ejemplo — Manuel elige destino (OneDrive, Drive, disco externo)
mv backup ~/archives/agente-busca-clientes-migration-YYYYMMDD
# Documentar en PROGRESS.md dónde quedaron
```

**B) Eliminar (si Manuel confirma que la migración es exitosa y los bundles no son necesarios):**
```bash
rm -rf backup/
```

`.gitignore` ya cubre `backup/` así que no hay nada que commitear de esto.

#### 7. Commit de cierre
```bash
git add docs/migration/PROGRESS.md docs/ig/PROGRESS.md
git commit -m "docs(migration): close monorepo consolidation, apex-leads archived"
git push origin master
```

#### 8. Verificación final de `docs/migration/PROGRESS.md`
- SESSION-MIG-05 marcado `[x]`.
- Todos los checklists post-migration en verde (excepto el de backups si Manuel optó por mantenerlos).
- Sección "Cierre" al final con 3 líneas:
  - Fecha de cierre.
  - Commits totales del monorepo post-migración.
  - Nota: "Migración completa. El proyecto vive en `agente-busca-clientes`."

### Fuera de scope
- Nuevas features.
- Optimizaciones de build.
- Cambios de infra.

## Definición de "terminado"

- [ ] `github.com/manu-180/apex-leads` marcado como Archived (candado visible en UI).
- [ ] README del repo archivado apunta al nuevo.
- [ ] `docs/ig/PROGRESS.md` tiene nota de migración al tope.
- [ ] `docs/migration/PROGRESS.md` con todo el checklist post-migration cerrado.
- [ ] Los 3 servicios verificados verdes (sidecar, Vercel, scheduler).
- [ ] Commit de cierre pusheado.
- [ ] Decisión sobre backups tomada (movidos o eliminados).

## Al terminar la sesión

Mensaje a Manuel:
1. "Migración completa ✓" con 3 bullets de lo entregado.
2. URL nueva del monorepo.
3. Recordatorio: "El repo viejo está archivado; cualquier integración externa que todavía apunte a `github.com/manu-180/apex-leads` seguirá funcionando por redirect pero conviene actualizarla a `agente-busca-clientes`."
4. Sugerir siguiente paso no-migración: "Con el monorepo listo, la próxima sesión puede volver al plan IG (SESSION-07 Apify setup, según `docs/ig/PROGRESS.md`)."

## Reglas generales

1. No archivar `apex-leads` hasta que los smoke tests E2E estén verdes.
2. Si algo falla, parar y consultar — no es reversible inmediato (archive se puede deshacer desde UI, pero es fricción).
3. Commit final debe ser limpio y claro: marca el fin de la migración.
4. A partir del cierre, todo trabajo futuro vive en el monorepo. No más dos repos.
