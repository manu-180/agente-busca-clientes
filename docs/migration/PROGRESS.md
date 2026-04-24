# PROGRESS — Consolidación Monorepo

> **Documento vivo.** Se actualiza al final de cada sesión de migración.

---

## Estado actual

**Última sesión completada:** (ninguna — plan recién creado 2026-04-24)
**Próxima sesión:** SESSION-MIG-01 — Pre-flight audit + backup
**Siguiente prompt:** `docs/migration/prompts/SESSION-MIG-01.md`

---

## Progreso por sesión

- [ ] SESSION-MIG-01 (Sonnet) · Pre-flight audit + backup + sincronización
- [ ] SESSION-MIG-02 (Opus) · Subtree merge + cleanup submodule roto
- [ ] SESSION-MIG-03 (Sonnet) · Monorepo hygiene + limpieza archivos pesados
- [ ] SESSION-MIG-04 (Sonnet) · Rename GitHub + reconfigurar deployments
- [ ] SESSION-MIG-05 (Sonnet) · Archive repo viejo + verificación final

---

## Snapshots pre-migración

_(Se completa en SESSION-MIG-01)_

- **ig-sidecar HEAD:** `_pending_`
- **apex-leads HEAD:** `_pending_`
- **Fecha de arranque:** `_pending_`
- **Bundles de respaldo:** `_pending_`

---

## Decisiones tomadas

_(Se agregan en orden cronológico al cerrar cada sesión)_

---

## Bloqueos / pendientes humanos

_(Inputs que Manuel necesita proveer o acciones manuales)_

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
