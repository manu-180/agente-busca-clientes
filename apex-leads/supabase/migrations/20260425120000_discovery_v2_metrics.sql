-- Discovery v2 metrics: materialized view + views + refresh function

-- 1) discovery_metrics_daily (matview, aggregated by day + source kind)
CREATE MATERIALIZED VIEW IF NOT EXISTS discovery_metrics_daily AS
SELECT
  date_trunc('day', dr.started_at)::date        AS day,
  dr.kind                                        AS source_kind,
  count(*) FILTER (WHERE dr.status = 'ok')       AS runs_ok,
  count(*) FILTER (WHERE dr.status <> 'ok')      AS runs_err,
  coalesce(sum(dr.users_seen), 0)                AS users_seen,
  coalesce(sum(dr.users_new), 0)                 AS users_new,
  (
    SELECT count(*)
    FROM instagram_leads il
    WHERE il.discovered_via = dr.kind
      AND date_trunc('day', il.contacted_at) = date_trunc('day', dr.started_at)
      AND il.status = 'contacted'
  )                                              AS dms_sent,
  (
    SELECT count(*)
    FROM instagram_leads il
    WHERE il.discovered_via = dr.kind
      AND date_trunc('day', il.contacted_at) = date_trunc('day', dr.started_at)
      AND il.replied_at IS NOT NULL
  )                                              AS replies
FROM discovery_runs dr
GROUP BY 1, 2;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dmd_day_kind
  ON discovery_metrics_daily(day, source_kind);

-- 2) dm_template_stats (regular view — small dataset, no need to materialize)
CREATE OR REPLACE VIEW dm_template_stats AS
SELECT
  t.id                                                         AS template_id,
  t.name,
  t.status,
  count(a.id)                                                  AS sends,
  count(a.id) FILTER (WHERE a.replied)                         AS replies,
  CASE
    WHEN count(a.id) > 0
    THEN round(100.0 * count(a.id) FILTER (WHERE a.replied) / count(a.id), 2)
    ELSE 0
  END                                                          AS ctr_pct,
  count(a.id) FILTER (WHERE a.replied) + 1                     AS beta_alpha,
  count(a.id) - count(a.id) FILTER (WHERE a.replied) + 1       AS beta_beta
FROM dm_templates t
LEFT JOIN dm_template_assignments a ON a.template_id = t.id
GROUP BY t.id, t.name, t.status;

-- 3) lead_funnel (snapshot last 30 days)
CREATE OR REPLACE VIEW lead_funnel AS
WITH window_days AS (
  SELECT generate_series(
    current_date - interval '29 days',
    current_date,
    '1 day'
  )::date AS day
)
SELECT
  w.day,
  (
    SELECT count(*) FROM instagram_leads_raw r
    WHERE r.created_at::date = w.day
  )                                                            AS raw_discovered,
  (
    SELECT count(*) FROM instagram_leads_raw r
    WHERE r.created_at::date = w.day
      AND r.processed = true
      AND r.processing_error IS NULL
  )                                                            AS pre_filter_passed,
  (
    SELECT count(*) FROM instagram_leads l
    WHERE l.created_at::date = w.day
  )                                                            AS enriched,
  (
    SELECT count(*) FROM instagram_leads l
    WHERE l.contacted_at::date = w.day
      AND l.status = 'contacted'
  )                                                            AS contacted,
  (
    SELECT count(*) FROM instagram_leads l
    WHERE l.replied_at::date = w.day
  )                                                            AS replied
FROM window_days w
ORDER BY w.day DESC;

-- 4) Refresh function (called by cron endpoint)
CREATE OR REPLACE FUNCTION refresh_discovery_metrics()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY discovery_metrics_daily;
END;
$$;
