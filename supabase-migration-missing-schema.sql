-- =============================================
-- APEX LEADS - Missing Schema Migration
-- Idempotente: safe to run multiple times
-- =============================================

-- ─── 1a. senders table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS senders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alias        TEXT NOT NULL,
  provider     TEXT NOT NULL CHECK (provider IN ('twilio', 'wassenger')),
  phone_number TEXT NOT NULL,
  descripcion  TEXT,
  color        TEXT NOT NULL DEFAULT '#84cc16',
  activo       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_senders_provider_phone ON senders(provider, phone_number);
CREATE INDEX IF NOT EXISTS idx_senders_activo ON senders(activo);

ALTER TABLE senders ENABLE ROW LEVEL SECURITY;

-- ─── 1b. demos_rubro table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS demos_rubro (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              TEXT UNIQUE NOT NULL,
  rubro_label       TEXT NOT NULL,
  url               TEXT NOT NULL,
  strong_keywords   TEXT[] NOT NULL DEFAULT '{}',
  weak_keywords     TEXT[] NOT NULL DEFAULT '{}',
  negative_keywords TEXT[] NOT NULL DEFAULT '{}',
  active            BOOLEAN NOT NULL DEFAULT true,
  priority          INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_demos_rubro_active ON demos_rubro(active);

ALTER TABLE demos_rubro ENABLE ROW LEVEL SECURITY;

-- ─── 1c. procesando_hasta column on leads ─────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'leads'
  ) THEN
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS procesando_hasta TIMESTAMPTZ;
  END IF;
END $$;

ALTER TABLE leads_apex_next ADD COLUMN IF NOT EXISTS procesando_hasta TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'leads' AND indexname = 'idx_leads_procesando_hasta'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'leads'
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_leads_procesando_hasta ON leads(procesando_hasta) WHERE procesando_hasta IS NOT NULL';
    END IF;
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_leads_apex_next_procesando_hasta
  ON leads_apex_next(procesando_hasta)
  WHERE procesando_hasta IS NOT NULL;

-- ─── 1d. sender_id column on conversaciones ───────────────────────────────────
ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS sender_id UUID REFERENCES senders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_conversaciones_sender_id ON conversaciones(sender_id);

-- ─── 1e. Fix RLS on trabajos and cuotas ──────────────────────────────────────
DO $$
BEGIN
  DROP POLICY IF EXISTS "service_role_trabajos" ON trabajos;
  DROP POLICY IF EXISTS "service_role_cuotas" ON cuotas;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trabajos' AND policyname = 'service_role_only_trabajos'
  ) THEN
    CREATE POLICY "service_role_only_trabajos" ON trabajos
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cuotas' AND policyname = 'service_role_only_cuotas'
  ) THEN
    CREATE POLICY "service_role_only_cuotas" ON cuotas
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

-- ─── 1f. RLS policies for new tables ─────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'senders' AND policyname = 'service_role_all_senders'
  ) THEN
    CREATE POLICY "service_role_all_senders" ON senders FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'demos_rubro' AND policyname = 'service_role_all_demos_rubro'
  ) THEN
    CREATE POLICY "service_role_all_demos_rubro" ON demos_rubro FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- ─── 1g. Inbox: una fila por lead (último mensaje) + índice para el DISTINCT ON ─
-- Requerido para /api/conversaciones: al superar muchos mensajes en total, un .limit(10000)
-- sobre toda la tabla dejaba afuera envíos recientes; este view evita el techo.
CREATE INDEX IF NOT EXISTS idx_conversaciones_lead_id_timestamp_desc
  ON public.conversaciones(lead_id, "timestamp" DESC)
  WHERE lead_id IS NOT NULL;

CREATE OR REPLACE VIEW public.conversaciones_ultima_por_lead AS
SELECT DISTINCT ON (lead_id) *
FROM public.conversaciones
WHERE lead_id IS NOT NULL
ORDER BY lead_id, "timestamp" DESC;
