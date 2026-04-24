# PROGRESS — Consolidación Monorepo

> **Documento vivo.** Se actualiza al final de cada sesión de migración.

---

## Estado actual

**Última sesión completada:** SESSION-MIG-02 — Subtree merge + cleanup submodule roto (2026-04-24)
**Próxima sesión:** SESSION-MIG-03 — Monorepo hygiene + limpieza archivos pesados
**Siguiente prompt:** `docs/migration/prompts/SESSION-MIG-03.md`

---

## Progreso por sesión

- [x] SESSION-MIG-01 (Sonnet) · Pre-flight audit + backup + sincronización
- [x] SESSION-MIG-02 (Opus) · Subtree merge + cleanup submodule roto
- [ ] SESSION-MIG-03 (Sonnet) · Monorepo hygiene + limpieza archivos pesados
- [ ] SESSION-MIG-04 (Sonnet) · Rename GitHub + reconfigurar deployments
- [ ] SESSION-MIG-05 (Sonnet) · Archive repo viejo + verificación final

---

## Snapshots pre-migración

- **ig-sidecar HEAD (pre-MIG-01):** `012c6734a3fc51c609a6dcea60a90c0d091630b1`
- **ig-sidecar HEAD (post-MIG-01):** `02cc34571c2563c0d480979fe201e7e74dd96d47`
- **apex-leads HEAD:** `7c431ad8a03330f155e2bcd5c94613b35f18ab49`
- **ig-sidecar HEAD (pre-MIG-02):** `9cd1640a1363e473af869c10b40337a260e10098`
- **ig-sidecar HEAD (post-MIG-02 / merge commit):** `3d43b697c2c1efae4fa3bf217aa2f4133fec5f71`
- **apex-leads HEAD (pre-merge):** `7c431ad8a03330f155e2bcd5c94613b35f18ab49`
- **Commits importados desde apex-leads:** 112
- **Fecha de arranque:** `2026-04-24`
- **Bundles de respaldo:**
  - `backup/ig-sidecar-20260424.bundle` — 121K — verificado OK
  - `backup/apex-leads-20260424.bundle` — 520K — verificado OK

---

## Inventario pre-migración

### Remotes originales
- **ig-sidecar:** `https://github.com/manu-180/ig-sidecar.git` (branch `master`)
- **apex-leads:** `https://github.com/manu-180/apex-leads.git` (branch `main`)

### Archivos grandes detectados (>10 MB)
- `apex-leads.zip` — 163 MB en working directory root (ya en `.gitignore`, nunca commiteado)
- Ningún otro archivo >10 MB encontrado fuera de node_modules / .next / .venv

### Secretos protegidos
- `sidecar/session_b64.txt` — cookies de sesión Instagram codificadas en base64 — en `.gitignore` ✅
- `sidecar/session_export.json` — export JSON de sesión Instagram — en `.gitignore` ✅
- Confirmado con `git check-ignore`: ambos archivos excluidos correctamente

### Referencias críticas
- Variables de entorno canonicas: `docs/ig/PROGRESS.md` sección "Variables de entorno capturadas"
- URLs operativas: `docs/ig/PROGRESS.md` sección "URLs y endpoints operativos"
- Contrato HTTP sidecar ↔ Next: `docs/ig/SIDECAR-CONTRACT.md`

---

## Decisiones tomadas

### SESSION-MIG-01 (2026-04-24)

**`sidecar/.gitignore` reescrito de UTF-16 a UTF-8**
- El archivo original fue creado con encoding UTF-16 (Windows), git no lo leía.
- Reescrito via `printf` en bash. Ahora excluye correctamente session_b64.txt y session_export.json.

**`backup/` agregado al root `.gitignore`**
- Los bundles son artefactos locales de seguridad, no deben entrar al repo.

**Gitlink `apex-leads` NO commiteado intencionalmente**
- El working tree del root muestra `modified: apex-leads (new commits)` — es el submodule roto esperado.
- Se resuelve en SESSION-MIG-02 via `git subtree add`.

---

### SESSION-MIG-02 (2026-04-24)

**Subtree merge sin `--squash` — historial individual preservado**
- Se agregó `apex-leads-origin` como remote temporal del repo padre.
- Se removió el gitlink roto (mode 160000) del índice via `git rm --cached apex-leads`.
- Se ejecutó `git subtree add --prefix=apex-leads apex-leads-origin/main` sin `--squash`.
- Resultado: 112 commits del repo apex-leads incorporados al historial del monorepo.
- Merge commit: `3d43b697c2c1efae4fa3bf217aa2f4133fec5f71`.
- `apex-leads/` es ahora un directorio regular (`040000 tree`), sin `.git/` propio.
- Remote `apex-leads-origin` eliminado post-merge.
- Carpeta temporal `../apex-leads-TEMP` eliminada (solo contenía archivos locales no trackeados).

## Bloqueos / pendientes humanos

_(ninguno para SESSION-MIG-03 — todo listo)_

---

## Post-migration checklist

_(Se completa en SESSION-MIG-05)_

- [ ] Repo único: `agente-busca-clientes`.
- [ ] Vercel build verde desde root `apex-leads/`.
- [ ] Sidecar `/health` verde.
- [ ] Scheduler última run exitosa.
- [ ] Repo `apex-leads` archivado.
- [ ] Docs finales actualizadas.
- [ ] Backups movidos fuera del repo.
