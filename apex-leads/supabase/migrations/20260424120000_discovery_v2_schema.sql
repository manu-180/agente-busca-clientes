-- Discovery System v2 — Phase 1 schema
-- Session D01: tablas nuevas + ALTER instagram_leads
-- Materialized view discovery_metrics_daily queda para D08.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── 1. discovery_sources ───────────────────────────────────────────────────
-- Definición de fuentes de descubrimiento activas (hashtag, location, etc.)
CREATE TABLE IF NOT EXISTS discovery_sources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('hashtag','location','competitor_followers','post_engagers')),
  ref           text NOT NULL,
  params        jsonb NOT NULL DEFAULT '{}'::jsonb,
  schedule_cron text NOT NULL DEFAULT '0 */6 * * *',
  active        boolean NOT NULL DEFAULT true,
  priority      int NOT NULL DEFAULT 50,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, ref)
);

COMMENT ON TABLE discovery_sources IS 'Fuentes configuradas para descubrimiento de leads (hashtag, location, competitor, post-engagers)';

CREATE INDEX IF NOT EXISTS idx_disc_sources_active ON discovery_sources(active, priority DESC);

-- ─── 2. discovery_runs ──────────────────────────────────────────────────────
-- Log inmutable de cada ejecución de descubrimiento
CREATE TABLE IF NOT EXISTS discovery_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id     uuid REFERENCES discovery_sources(id) ON DELETE SET NULL,
  kind          text NOT NULL,
  ref           text NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,
  status        text NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','error','rate_limited','circuit_open')),
  users_seen    int DEFAULT 0,
  users_new     int DEFAULT 0,
  error_message text,
  metadata      jsonb DEFAULT '{}'::jsonb
);

COMMENT ON TABLE discovery_runs IS 'Log inmutable de cada llamada al sidecar de descubrimiento';

CREATE INDEX IF NOT EXISTS idx_disc_runs_started ON discovery_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_disc_runs_source  ON discovery_runs(source_id, started_at DESC);

-- ─── 3. niche_classifications ────────────────────────────────────────────────
-- Cache de clasificaciones de nicho realizadas por Claude Haiku
CREATE TABLE IF NOT EXISTS niche_classifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ig_username   text NOT NULL,
  niche         text NOT NULL,
  confidence    numeric(3,2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  reason        text,
  classifier    text NOT NULL DEFAULT 'claude-haiku-4',
  prompt_hash   text NOT NULL,
  classified_at timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);

COMMENT ON TABLE niche_classifications IS 'Clasificaciones de nicho (Haiku) con cache de 30 días por bio+category hash';

-- Nota: índice parcial con now() no es posible (not IMMUTABLE); la app gestiona el lookup activo.
CREATE INDEX IF NOT EXISTS idx_niche_username    ON niche_classifications(ig_username, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_niche_prompt_hash ON niche_classifications(prompt_hash);

-- ─── 4. scoring_weights ──────────────────────────────────────────────────────
-- Versiones de pesos del modelo de scoring Bayesiano
CREATE TABLE IF NOT EXISTS scoring_weights (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version      int NOT NULL,
  status       text NOT NULL DEFAULT 'staging' CHECK (status IN ('staging','production','retired')),
  weights      jsonb NOT NULL,
  trained_on_n int NOT NULL DEFAULT 0,
  promoted_at  timestamptz,
  retired_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  notes        text
);

COMMENT ON TABLE scoring_weights IS 'Versiones versionadas de pesos del scoring Bayesiano (staging/production/retired)';

CREATE UNIQUE INDEX IF NOT EXISTS idx_scoring_one_production ON scoring_weights(status) WHERE status='production';
CREATE INDEX IF NOT EXISTS idx_scoring_version ON scoring_weights(version DESC);

-- ─── 5. dm_templates ─────────────────────────────────────────────────────────
-- Templates de DM para A/B testing con Thompson sampling
-- (debe ir antes de lead_score_history y dm_template_assignments por FKs)
CREATE TABLE IF NOT EXISTS dm_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  body       text NOT NULL,
  variables  text[] NOT NULL DEFAULT '{}',
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','paused','killed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  killed_at  timestamptz,
  notes      text
);

COMMENT ON TABLE dm_templates IS 'Templates de DM con placeholders; selección por Thompson sampling';

-- ─── 6. lead_score_history ───────────────────────────────────────────────────
-- Historial de scores por lead para auditar drift del modelo
CREATE TABLE IF NOT EXISTS lead_score_history (
  id              bigserial PRIMARY KEY,
  lead_id         uuid NOT NULL REFERENCES instagram_leads(id) ON DELETE CASCADE,
  weights_version int NOT NULL,
  score           int NOT NULL,
  features        jsonb NOT NULL,
  computed_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE lead_score_history IS 'Historial de scores por lead; permite auditar drift del modelo Bayesiano';

CREATE INDEX IF NOT EXISTS idx_score_hist_lead ON lead_score_history(lead_id, computed_at DESC);

-- ─── 7. dm_template_assignments ──────────────────────────────────────────────
-- Asignación de template por lead + outcome para Thompson sampling
CREATE TABLE IF NOT EXISTS dm_template_assignments (
  id                 bigserial PRIMARY KEY,
  lead_id            uuid NOT NULL REFERENCES instagram_leads(id) ON DELETE CASCADE,
  template_id        uuid NOT NULL REFERENCES dm_templates(id),
  sent_at            timestamptz NOT NULL DEFAULT now(),
  replied            boolean NOT NULL DEFAULT false,
  replied_at         timestamptz,
  reply_was_positive boolean,
  UNIQUE (lead_id, template_id)
);

COMMENT ON TABLE dm_template_assignments IS 'Asignación lead→template con outcome para actualizar stats Thompson sampling';

CREATE INDEX IF NOT EXISTS idx_dm_assign_template ON dm_template_assignments(template_id, replied);

-- ─── 8. lead_blacklist ───────────────────────────────────────────────────────
-- Lista negra de usuarios que no deben recibir DMs
CREATE TABLE IF NOT EXISTS lead_blacklist (
  ig_username    text PRIMARY KEY,
  reason         text NOT NULL,
  blacklisted_at timestamptz NOT NULL DEFAULT now(),
  blacklisted_by text NOT NULL DEFAULT 'system'
);

COMMENT ON TABLE lead_blacklist IS 'Usuarios de Instagram bloqueados permanentemente del pipeline de DMs';

-- ─── 9. alerts_log ───────────────────────────────────────────────────────────
-- Log de alertas disparadas (circuit breaker, low reply rate, etc.)
CREATE TABLE IF NOT EXISTS alerts_log (
  id           bigserial PRIMARY KEY,
  severity     text NOT NULL CHECK (severity IN ('info','warning','critical')),
  source       text NOT NULL,
  message      text NOT NULL,
  metadata     jsonb DEFAULT '{}'::jsonb,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  acked_at     timestamptz
);

COMMENT ON TABLE alerts_log IS 'Log de alertas del sistema (circuit_open, low_reply_rate, quota_unmet)';

-- ─── 10. ALTER instagram_leads ───────────────────────────────────────────────
-- Columnas nuevas para niche, scoring v2 y tracking de replies
ALTER TABLE instagram_leads
  ADD COLUMN IF NOT EXISTS niche             text,
  ADD COLUMN IF NOT EXISTS niche_confidence  numeric(3,2),
  ADD COLUMN IF NOT EXISTS engagement_rate   numeric(5,4),
  ADD COLUMN IF NOT EXISTS scoring_version   int,
  ADD COLUMN IF NOT EXISTS template_id       uuid REFERENCES dm_templates(id),
  ADD COLUMN IF NOT EXISTS replied_at        timestamptz;

CREATE INDEX IF NOT EXISTS idx_leads_niche        ON instagram_leads(niche);
CREATE INDEX IF NOT EXISTS idx_leads_status_score ON instagram_leads(status, lead_score DESC);
