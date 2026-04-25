# SESSION-D14 — Ramp-up + Runbook + Cleanup legacy

> **Modelo recomendado:** Sonnet
> **Duración estimada:** 1 sesión (~1.5h)
> **Prerequisitos:** D01–D13 ✅, todos los chaos drills pasados.

---

## Contexto

Lectura: `MASTER-PLAN.md` § 11, 13. PROGRESS.md.

Última sesión. Pasamos de DRY_RUN a live, definimos política de ramp-up gradual con kill-switches, escribimos el runbook ops para que Manuel pueda operar sin Claude. Limpiamos código legacy de Apify.

---

## Objetivo

1. `RUNBOOK.md` operacional completo en `docs/discovery/`.
2. Switch DRY_RUN → false (con plan de rollback).
3. Ramp-up plan: día 1 = 5 DMs, +5/día sin incidente, hasta 30.
4. Eliminar código legacy Apify (`/api/cron/ig-discover/`, `/api/webhooks/apify/`, env vars).
5. Tag de release `discovery-v2.0.0`.
6. Reporte final en PROGRESS.md.

---

## Paso 1 — Branch

```bash
git checkout -b chore/discovery-d14-launch
```

---

## Paso 2 — RUNBOOK

`docs/discovery/RUNBOOK.md`:

```markdown
# Discovery System v2 — Runbook Ops

## Healthcheck diario (5 min de Manuel cada mañana)

1. Abrir `https://leads.theapexweb.com/admin/ig`
2. Verificar:
   - Reply Rate (7d) ≥ 5% — si <3% por 3 días → revisar templates
   - Pipeline Health ≥ 95% — si menor → ver Discord alerts
   - DMs Today se está acumulando proporcional a la hora del día
   - Discovery por fuente: ningún kind con 0 runs en 24h
3. Si todo verde → done.

## Métricas por revisar semanalmente

- `dm_template_stats`: hay templates con CTR muy bajo? Pause manual o esperar auto.
- `lead_funnel`: % de raw que llega a contacted. Si <10% → pre-filter o niche classifier muy estricto.
- `scoring_weights`: hay nuevo staging? Decidir promote/reject los lunes.

## Escalación

| Síntoma | Severidad | Acción |
|---|---|---|
| Discord alert "circuit_open" | 🔴 critical | Inmediato: SSH Railway, ver logs sidecar, re-login si es challenge |
| Reply rate cae 50% en 3d | 🟡 warning | Revisar templates auto-pause, considerar nuevas variantes |
| 0 leads descubiertos 24h | 🟡 warning | Verificar `discovery_sources active=true` y orchestrator cron logs |
| `niche_classifications` no crece | 🟡 warning | ANTHROPIC_API_KEY válida? Cuota Claude API ok? |
| DAILY_DM_LIMIT alcanzado muy temprano | 🟢 info | OK, queremos saturar quota |
| Sidecar /health = degraded | 🔴 critical | session inválida → re-login manual desde Railway shell |

## Procedimientos

### Re-login sidecar
```bash
railway shell -s ig-sidecar
python
>>> from app.ig_client import get_ig_client, reset_ig_client
>>> reset_ig_client()
>>> get_ig_client().login()
>>> exit()
```
Si pide challenge: ir a IG en celular, aprobar device. Reintentar login.

### Pause global (kill switch)
Vercel env var `DISCOVERY_ENABLED=false` → redeploy. Orchestrator no-op. Run-cycle sigue (procesa raw existente).

Para pausar TODO incluyendo run-cycle: `DRY_RUN=true` + `DISCOVERY_ENABLED=false`.

### Rollback de scoring weights
```sql
UPDATE scoring_weights SET status='production', promoted_at=now() WHERE version=<previous>;
UPDATE scoring_weights SET status='retired', retired_at=now() WHERE version=<bad>;
```

### Rotar APIFY_TOKEN (legacy, solo si todavía vive en alguna rama)
N/A — eliminado en D14.

### Rotar Discord webhook
Crear nueva URL en Discord → setear `DISCORD_ALERT_WEBHOOK` → redeploy.

## SLOs

- Sidecar uptime ≥ 99% mensual
- Reply rate ≥ 5% rolling 30d
- Cost per reply ≤ $0.10
- Time-to-DM (discovery → DM) p50 ≤ 24h

## On-call

Manuel es único on-call. Discord notifications en celular activadas.
```

---

## Paso 3 — Ramp-up plan

`docs/discovery/RAMPUP-PLAN.md`:

```markdown
# Ramp-up Plan — DRY_RUN → live

## Fase 0 (hoy): pre-flight

- [ ] Todos los chaos drills D13 pasados
- [ ] Reply rate teórico (qualified rate × tasa esperada) ≥ 5%
- [ ] Manuel revisa últimas 50 entries del log dry-run y confirma calidad
- [ ] Backup Supabase exportado

## Día 1: live cauteloso

- Vercel env: `DRY_RUN=false`, `DAILY_DM_LIMIT=5`
- Trigger 1 run-cycle manual a las 10:00 ART
- Esperar 30 min
- Verificar:
  - DM enviado realmente (chequear IG cuenta apex.stack)
  - `instagram_conversations` con role=assistant insertado
  - Sidecar `/health` ok
  - No challenge en IG

Si todo OK → dejar correr cron normal hasta fin de día.

## Días 2-7: ramp gradual

| Día | DAILY_DM_LIMIT | Condición para subir |
|---|---|---|
| 2 | 10 | Día 1 sin incidente, 0 challenges |
| 3 | 15 | Día 2 sin incidente, reply rate ≥ 5% |
| 4 | 20 | igual |
| 5 | 25 | igual |
| 6 | 30 | igual |
| 7+ | 30 | techo conservador |

## Si pasa algo malo

- Challenge IG → DAILY_DM_LIMIT=0, investigar, esperar 48h, retomar en mitad del valor previo
- Reply rate <2% por 3d → pause sources noisiest, re-evaluar templates
- Costo Claude > $50/mes → revisar cache niche, considerar batch enrich

## Métricas para subir el techo > 30 (futuro)

Solo después de 30 días estables a 30/día Y reply rate ≥ 8% sostenido.
```

---

## Paso 4 — Cleanup legacy Apify

```bash
git rm apex-leads/src/app/api/cron/ig-discover/route.ts
git rm apex-leads/src/app/api/webhooks/apify/route.ts
```

Eliminar de `lib/ig/config.ts`:
- `APIFY_TOKEN`
- `APIFY_WEBHOOK_SECRET`

Eliminar las env vars en Vercel (REST API o dashboard).

Eliminar de `vercel.json`: el cron de ig-discover si seguía.

Grep final: `git grep -i 'apify'` debe devolver 0 referencias en código (sí en docs/ig/ históricos, OK).

---

## Paso 5 — Update env vars producción

Vercel:
- `DRY_RUN=false` (después de día 1 manual ok)
- `DAILY_DM_LIMIT=5` día 1, ajustar manualmente cada día
- Eliminar APIFY_*

---

## Paso 6 — Tag release

```bash
git add -A
git commit -m "chore(discovery): D14 launch v2.0.0 — runbook, rampup plan, legacy cleanup"
git push origin chore/discovery-d14-launch
# PR + merge
git checkout master && git pull
git tag -a discovery-v2.0.0 -m "Discovery System v2 — full launch"
git push origin discovery-v2.0.0
```

---

## Paso 7 — Reporte final en PROGRESS

Al cerrar, agregar sección al final de PROGRESS.md:

```markdown
## 🚀 LAUNCHED — Discovery v2

**Fecha launch:** YYYY-MM-DD
**Tag:** discovery-v2.0.0
**Snapshot:**
- Tablas activas: discovery_sources (N), templates (M), production weights v(X)
- Discovery throughput estimado: X leads/día
- Cost mensual proyectado: ~$Y/mes (Claude tokens)
- Healthcheck: ver /admin/ig

Manuel asume operación según RUNBOOK.md y RAMPUP-PLAN.md.
```

---

## Criterios de éxito

1. ✅ RUNBOOK + RAMPUP-PLAN escritos.
2. ✅ Legacy Apify eliminado.
3. ✅ DRY_RUN=false aplicado, día 1 ejecutado sin incidente.
4. ✅ Tag git creado.
5. ✅ Manuel firma off en PROGRESS.md.

---

## Cierre

- Update PROGRESS D14 → ✅, sección "LAUNCHED" agregada.
- Celebrar.
