-- Compromiso de boceto en ~24h (cola "Enviar bocetos" en Inbox)
-- Idempotente: ejecutar en Supabase SQL Editor

ALTER TABLE leads ADD COLUMN IF NOT EXISTS boceto_prometido_24h BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS boceto_prometido_24h_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_boceto_prometido_24h
  ON leads(boceto_prometido_24h)
  WHERE boceto_prometido_24h = true;

ALTER TABLE leads_apex_next ADD COLUMN IF NOT EXISTS boceto_prometido_24h BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leads_apex_next ADD COLUMN IF NOT EXISTS boceto_prometido_24h_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_apex_next_boceto_prometido_24h
  ON leads_apex_next(boceto_prometido_24h)
  WHERE boceto_prometido_24h = true;
