# SESSION-D08 — Metrics layer (materialized views + funnels)

> **Modelo recomendado:** Sonnet
> **Duración estimada:** 1 sesión (~1.5h)
> **Prerequisitos:** D01–D07 ✅, datos reales fluyendo en raw + leads + runs.

---

## Contexto

Lectura: `MASTER-PLAN.md` § 9, `ARCHITECTURE.md` § 4.8. PROGRESS.md.

Sin métricas el sistema es ciego. Esta sesión expone:
- `discovery_metrics_daily` (matview, agregada por día y kind)
- vista `dm_template_stats` (sends/replies/CTR/Beta CIs)
- vista `lead_funnel` (raw → filtered → enriched → contacted → replied)
- cron diario que refresca todo

---

## Objetivo

1. Migración con la matview + 2 vistas + cron job logical (refresh manual via endpoint).
2. Endpoint `/api/cron/refresh-metrics` que llama `REFRESH MATERIALIZED VIEW CONCURRENTLY discovery_metrics_daily;`.
3. Cron Vercel `0 2 * * *` (02:00 UTC).
4. Helper TS `lib/ig/metrics/queries.ts` con queries tipadas para el dashboard.

---

## Paso 1 — Branch + migración

```bash
git checkout -b feat/discovery-d08-metrics
```

Archivo `apex-leads/supabase/migrations/<ts>_discovery_v2_metrics.sql`:

```sql
-- 1) discovery_metrics_daily (matview)
CREATE MATERIALIZED VIEW IF NOT EXISTS discovery_metrics_daily AS
SELECT
  date_trunc('day', dr.started_at)::date AS day,
  dr.kind AS source_kind,
  count(*) FILTER (WHERE dr.status='ok')          AS runs_ok,
  count(*) FILTER (WHERE dr.status<>'ok')         AS runs_err,
  coalesce(sum(dr.users_seen), 0)                  AS users_seen,
  coalesce(sum(dr.users_new), 0)                   AS users_new,
  (SELECT count(*) FROM instagram_leads il
    WHERE il.discovered_via = dr.kind
      AND date_trunc('day', il.contacted_at) = date_trunc('day', dr.started_at)
      AND il.status='contacted')                   AS dms_sent,
  (SELECT count(*) FROM instagram_leads il
    WHERE il.discovered_via = dr.kind
      AND date_trunc('day', il.contacted_at) = date_trunc('day', dr.started_at)
      AND il.replied_at IS NOT NULL)               AS replies
FROM discovery_runs dr
GROUP BY 1, 2;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dmd_day_kind ON discovery_metrics_daily(day, source_kind);

-- 2) dm_template_stats (vista normal, lectura cara pero datos pequeños)
CREATE OR REPLACE VIEW dm_template_stats AS
SELECT
  t.id AS template_id,
  t.name,
  t.status,
  count(a.id) AS sends,
  count(a.id) FILTER (WHERE a.replied) AS replies,
  CASE WHEN count(a.id) > 0
    THEN round(100.0 * count(a.id) FILTER (WHERE a.replied) / count(a.id), 2)
    ELSE 0 END AS ctr_pct,
  count(a.id) FILTER (WHERE a.replied) + 1 AS beta_alpha,
  count(a.id) - count(a.id) FILTER (WHERE a.replied) + 1 AS beta_beta
FROM dm_templates t
LEFT JOIN dm_template_assignments a ON a.template_id = t.id
GROUP BY t.id, t.name, t.status;

-- 3) lead_funnel (snapshot últimos 30 días)
CREATE OR REPLACE VIEW lead_funnel AS
WITH window_days AS (
  SELECT generate_series(current_date - interval '29 days', current_date, '1 day')::date AS day
)
SELECT
  w.day,
  (SELECT count(*) FROM instagram_leads_raw r WHERE r.created_at::date = w.day) AS raw_discovered,
  (SELECT count(*) FROM instagram_leads_raw r WHERE r.created_at::date = w.day AND r.processed=true AND r.processing_error IS NULL) AS pre_filter_passed,
  (SELECT count(*) FROM instagram_leads l WHERE l.created_at::date = w.day) AS enriched,
  (SELECT count(*) FROM instagram_leads l WHERE l.contacted_at::date = w.day AND l.status='contacted') AS contacted,
  (SELECT count(*) FROM instagram_leads l WHERE l.replied_at::date = w.day) AS replied
FROM window_days w
ORDER BY w.day DESC;
```

Aplicar via MCP `apply_migration` name `discovery_v2_metrics`.

---

## Paso 2 — Refresh endpoint

`apex-leads/src/app/api/cron/refresh-metrics/route.ts`:

```typescript
export async function GET(req: NextRequest) {
  // auth Bearer CRON_SECRET
  const supabase = createSupabaseServer()
  const { error } = await supabase.rpc('refresh_discovery_metrics')   // crear esa función SQL
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, refreshed_at: new Date().toISOString() })
}
```

Función SQL (incluir en migración del Paso 1):
```sql
CREATE OR REPLACE FUNCTION refresh_discovery_metrics() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY discovery_metrics_daily;
END;
$$;
```

Agregar a `vercel.json`:
```json
{ "path": "/api/cron/refresh-metrics", "schedule": "0 2 * * *" }
```

---

## Paso 3 — Helpers TS

`lib/ig/metrics/queries.ts`:

```typescript
export interface DailyMetric { day: string; source_kind: string; users_seen: number; users_new: number; dms_sent: number; replies: number }
export async function getDailyMetrics(supabase, days = 30): Promise<DailyMetric[]> {
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)
  const { data } = await supabase.from('discovery_metrics_daily').select('*').gte('day', since).order('day', { ascending: false })
  return data ?? []
}

export async function getKpiSnapshot(supabase): Promise<{ replyRate7d: number; qualifiedRate30d: number; dmsToday: number; pipelineHealth: number }> {
  // Reply Rate 7d
  const since7 = new Date(Date.now() - 7 * 86400_000).toISOString()
  const { count: dms } = await supabase.from('instagram_leads').select('*', { count: 'exact', head: true }).gte('contacted_at', since7)
  const { count: reps } = await supabase.from('instagram_leads').select('*', { count: 'exact', head: true }).gte('replied_at', since7)
  const replyRate7d = dms ? Math.round((100 * (reps ?? 0)) / dms) : 0

  // Qualified Rate 30d (score ≥ MIN_SCORE / total enriched)
  const since30 = new Date(Date.now() - 30 * 86400_000).toISOString()
  const { count: enr } = await supabase.from('instagram_leads').select('*', { count: 'exact', head: true }).gte('created_at', since30)
  const { count: qual } = await supabase.from('instagram_leads').select('*', { count: 'exact', head: true }).gte('created_at', since30).gte('lead_score', 60)
  const qualifiedRate30d = enr ? Math.round((100 * (qual ?? 0)) / enr) : 0

  // DMs hoy
  const today = new Date().toISOString().slice(0, 10)
  const { data: q } = await supabase.from('dm_daily_quota').select('dms_sent').eq('day', today)
  const dmsToday = (q ?? []).reduce((s, r: any) => s + r.dms_sent, 0)

  // Pipeline health: % discovery_runs OK últimos 7d
  const { data: runs } = await supabase.from('discovery_runs').select('status').gte('started_at', since7)
  const total = (runs ?? []).length
  const ok = (runs ?? []).filter((r: any) => r.status === 'ok').length
  const pipelineHealth = total ? Math.round((100 * ok) / total) : 100
  return { replyRate7d, qualifiedRate30d, dmsToday, pipelineHealth }
}

export async function getTemplateStats(supabase) {
  const { data } = await supabase.from('dm_template_stats').select('*')
  return data ?? []
}

export async function getLeadFunnel(supabase) {
  const { data } = await supabase.from('lead_funnel').select('*')
  return data ?? []
}
```

---

## Paso 4 — Tests

Integration tests con datos seed mínimos (insertar 3 discovery_runs, 5 leads, refrescar matview, asserts).

---

## Paso 5 — Smoke

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" https://leads.theapexweb.com/api/cron/refresh-metrics | jq
```

Verificar:
```sql
SELECT * FROM discovery_metrics_daily ORDER BY day DESC LIMIT 10;
SELECT * FROM lead_funnel LIMIT 5;
SELECT * FROM dm_template_stats;
```

---

## Criterios de éxito

1. ✅ Matview + 2 vistas creadas.
2. ✅ Refresh function corre sin error.
3. ✅ Cron Vercel registrado.
4. ✅ Helpers TS devuelven datos correctos.
5. ✅ Smoke test exitoso.

---

## Cierre

- Update PROGRESS D08 → ✅
- PR
