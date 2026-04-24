# SESSION-MIG-02 — Subtree merge + cleanup submodule roto

**Modelo recomendado:** `claude-opus-4-7`
**Permisos recomendados:** bash (git avanzado)
**Duración estimada:** 45–90 min

---

## Rol y contexto

Sos un ingeniero senior con experiencia profunda en Git interno (subtree, gitlinks, historial). Seguís el plan de consolidación monorepo de Manuel (`docs/migration/MASTER-PLAN.md`).

**Trabajo previo:**
- SESSION-MIG-01 dejó ambos repos sincronizados (`ig-sidecar` + `apex-leads`), con bundles de respaldo en `backup/` e inventario completo en `docs/migration/PROGRESS.md`.

**Esta es la SESIÓN 2 de 5.** Es la sesión con mayor riesgo técnico del plan. Objetivo: unificar el historial de `apex-leads` dentro del repo `ig-sidecar` preservando todos los commits, y convertir `apex-leads/` en un directorio regular (eliminando el gitlink roto).

## Paso 0 — Orientación (OBLIGATORIO)

Antes de ejecutar acciones:

1. Leé `docs/migration/MASTER-PLAN.md` completo, especialmente sección 4 (estrategia de preservación de historial) y sección 6 (riesgos).
2. Leé `docs/migration/PROGRESS.md` — necesitás los SHAs pre-migración.
3. Verificá que los bundles de backup existen y son válidos:
   ```bash
   ls -lh backup/
   git bundle verify backup/ig-sidecar-*.bundle
   git bundle verify backup/apex-leads-*.bundle
   ```
4. Confirmá al usuario el plan en 2 oraciones antes de empezar.

## Scope de SESSION-MIG-02

### Objetivo único
Convertir `apex-leads/` de submodule roto (gitlink 160000) a directorio regular dentro del repo `ig-sidecar`, con el historial completo del repo `apex-leads` fusionado en el historial del monorepo. Cero pérdida de commits.

### Conceptos clave

**Situación actual:**
```
ig-sidecar (repo padre)
├── .git/
└── apex-leads/        ← gitlink 160000 → commit 7c431ad (o el que esté actual)
    └── .git/          ← repo independiente apex-leads
```

**Situación objetivo:**
```
agente-busca-clientes (repo único, aún llamado ig-sidecar en GitHub hasta MIG-04)
├── .git/              ← historial de AMBOS repos mergeado
└── apex-leads/        ← directorio regular, files trackeados normalmente
    └── (sin .git/)
```

**Herramienta:** `git subtree add --prefix=apex-leads`. Sin `--squash` para preservar commits individuales. Esto crea un merge commit que une las dos historias.

### Tareas concretas

#### 1. Pre-flight checks
```bash
# Estado limpio obligatorio antes de empezar
git status                         # debe estar clean
git -C apex-leads status           # debe estar clean
git fetch origin
git fetch -C apex-leads origin

# Registrar SHAs actuales por si hay que rollback
git rev-parse HEAD > /tmp/mig02-padre-before.txt
cat /tmp/mig02-padre-before.txt
git -C apex-leads rev-parse HEAD > /tmp/mig02-apex-before.txt
cat /tmp/mig02-apex-before.txt
```

Si algo no está clean, parar y volver a SESSION-MIG-01.

#### 2. Agregar el repo `apex-leads` como remote del repo padre
```bash
# Desde root del monorepo
git remote add apex-leads-origin https://github.com/manu-180/apex-leads.git
git fetch apex-leads-origin

# Verificar que tenemos la rama main
git branch -r | grep apex-leads-origin
# Esperado: apex-leads-origin/main (y quizá otras)

# Registrar el HEAD remoto que vamos a importar
git rev-parse apex-leads-origin/main
```

El SHA debe coincidir con el `apex-leads HEAD` documentado en PROGRESS.md (post SESSION-MIG-01). Si no coincide, pushear lo que falte desde `apex-leads/` antes de seguir.

#### 3. Eliminar el gitlink roto
**Crítico:** git subtree add falla si el path `apex-leads/` ya existe en el índice. Hay que remover el gitlink del índice (no los archivos del disco).

```bash
# Mover la carpeta apex-leads fuera del repo temporalmente (preserva archivos locales)
mv apex-leads ../apex-leads-TEMP

# Remover el gitlink del índice y commitear
git rm --cached apex-leads     # si falla, probar: git rm -rf --cached apex-leads
git status                     # debe mostrar apex-leads eliminado del tree
git commit -m "chore(monorepo): remove broken apex-leads gitlink before subtree merge"
```

#### 4. Subtree add preservando historial
```bash
git subtree add --prefix=apex-leads apex-leads-origin/main
```

**No usar `--squash`.** Queremos que `git log -- apex-leads/` muestre los commits individuales.

Si falla con "working tree has modifications", revisar `git status` — debe estar limpio antes del subtree add.

Tras el comando exitoso:
- Se creó un merge commit que une ambas historias.
- `apex-leads/` existe como directorio regular con todos los archivos.
- `git log --oneline -- apex-leads/` muestra los commits de apex-leads.

#### 5. Verificar integridad post-merge
```bash
# 1. El árbol del monorepo contiene apex-leads como directorio regular (no gitlink)
git ls-tree HEAD apex-leads | head -1
# Esperado: algo que empiece con "040000 tree ..." (NO "160000 commit ...")

# 2. El historial de apex-leads está presente
git log --oneline -- apex-leads/ | head -20
# Esperado: ver commits históricos de apex-leads (7c431ad, 607e3f2, 2840f47, etc.)

# 3. Un commit conocido de apex-leads es alcanzable
git cat-file -t 7c431ad    # debería decir "commit"
git log 7c431ad --oneline -1

# 4. Todos los archivos esperados están en disco
ls apex-leads/package.json apex-leads/src/app apex-leads/next.config.js
```

Si alguna verificación falla: **parar**, no commitear nada más, y evaluar rollback con el bundle.

#### 6. Limpiar la carpeta temporal
Si los archivos del subtree coinciden con lo que había antes (sin cambios locales pendientes), borrar la temporal:
```bash
# Comparar rápido
diff -rq apex-leads ../apex-leads-TEMP | head -20

# Si no hay diferencias críticas (solo .git/ o node_modules):
rm -rf ../apex-leads-TEMP
```

Si hay diferencias relevantes en archivos trackeados, parar y consultar a Manuel: significa que había cambios en `apex-leads/` local sin pushear a su remote (no debería pasar si MIG-01 se hizo bien).

Nota: `apex-leads/.git/` desapareció (correcto — ya no es repo independiente). `node_modules/`, `.next/`, `.vercel/` etc. siguen en disco pero no están trackeados por git (respetan el `.gitignore` de apex-leads que ahora es parte del monorepo).

#### 7. Remover el remote temporal
Ya no lo necesitamos:
```bash
git remote remove apex-leads-origin
git remote -v    # solo debe quedar "origin"
```

#### 8. Push del merge
```bash
git log --oneline -5
# Debe mostrar el merge commit del subtree arriba del "remove broken gitlink"

git push origin master
```

GitHub va a recibir un push con muchos commits nuevos (los de apex-leads) + el merge commit. Tamaño considerable pero normal.

#### 9. Actualizar `docs/migration/PROGRESS.md`
- Marcar SESSION-MIG-02 como `[x]`.
- Registrar:
  - SHA pre-merge del repo padre (de `/tmp/mig02-padre-before.txt`).
  - SHA pre-merge de apex-leads (de `/tmp/mig02-apex-before.txt`).
  - SHA del merge commit resultante (`git log -1 --format=%H`).
  - Cantidad aproximada de commits importados (`git rev-list --count HEAD ^<sha-pre-merge>`).
- Sección "Decisiones tomadas" con: "Subtree merge sin `--squash` — historial individual preservado".

Commit final:
```bash
git add docs/migration/PROGRESS.md
git commit -m "docs(migration): session-02 subtree merge complete, historial preservado"
git push origin master
```

### Fuera de scope
- Renombrar repo en GitHub (SESSION-MIG-04).
- READMEs, ARCHITECTURE.md (SESSION-MIG-03).
- Limpieza del zip grande (SESSION-MIG-03).
- Reconfigurar Railway/Vercel (SESSION-MIG-04).

## Plan de rollback (si algo sale mal)

Si tras el subtree add el estado es inconsistente y no podemos recuperar:

```bash
# Volver al SHA pre-merge (antes del "remove broken gitlink")
SHA_BEFORE=$(cat /tmp/mig02-padre-before.txt)
git reset --hard "$SHA_BEFORE"

# Si ya se pushearon commits, esto requiere --force:
# ⚠️ CONFIRMAR CON MANUEL antes de force push.
```

Si el reset no alcanza, restaurar desde bundle:
```bash
cd ..
mv agente_busca_clientes agente_busca_clientes-broken
git clone backup/ig-sidecar-<fecha>.bundle agente_busca_clientes
# Y clonar apex-leads desde su bundle en su lugar original
```

## Definición de "terminado"

- [ ] `git ls-tree HEAD apex-leads` muestra `040000 tree` (no gitlink).
- [ ] `git log --oneline -- apex-leads/` muestra commits históricos de apex-leads.
- [ ] `apex-leads/package.json` existe y es leíble.
- [ ] `apex-leads/.git/` no existe.
- [ ] `git remote -v` solo muestra `origin`.
- [ ] `git status` = clean.
- [ ] `git push origin master` exitoso.
- [ ] `PROGRESS.md` actualizado con SHAs y commit count.
- [ ] Carpeta temporal `../apex-leads-TEMP` eliminada (salvo que haya alertas).

## Al terminar la sesión

Mensaje a Manuel:
1. Resumen en 3–5 bullets.
2. SHA del merge commit y cantidad de commits importados.
3. Confirmación de que backups siguen intactos.
4. Comando exacto:
   ```
   Nueva sesión → /model claude-sonnet-4-6 → pegar docs/migration/prompts/SESSION-MIG-03.md
   ```

## Reglas generales

1. No ejecutar ningún paso sin backup verificado de SESSION-MIG-01.
2. No `--force push` sin consentimiento explícito de Manuel.
3. Commits atómicos con prefijo `chore(monorepo):` o `docs(migration):`.
4. Ante cualquier anomalía en las verificaciones, parar.
