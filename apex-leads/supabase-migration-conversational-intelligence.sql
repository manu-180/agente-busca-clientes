-- Ejecutar en Supabase SQL Editor (una vez) — eventos conversacionales + cierre suave

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'leads'
  ) THEN
    ALTER TABLE leads
      ADD COLUMN IF NOT EXISTS conversacion_cerrada BOOLEAN NOT NULL DEFAULT false;

    ALTER TABLE leads
      ADD COLUMN IF NOT EXISTS conversacion_cerrada_at TIMESTAMPTZ;
  END IF;
END $$;

ALTER TABLE leads_apex_next
  ADD COLUMN IF NOT EXISTS conversacion_cerrada BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE leads_apex_next
  ADD COLUMN IF NOT EXISTS conversacion_cerrada_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS conversational_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID,
  telefono TEXT NOT NULL,
  event_name TEXT NOT NULL,
  decision_action TEXT,
  decision_reason TEXT,
  confidence NUMERIC(5,4),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversational_events_created_at
  ON conversational_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversational_events_event_name
  ON conversational_events(event_name);

CREATE INDEX IF NOT EXISTS idx_conversational_events_lead
  ON conversational_events(lead_id);
