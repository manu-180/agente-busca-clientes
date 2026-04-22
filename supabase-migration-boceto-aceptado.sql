-- Aceptación de boceto (cola "Enviar bocetos" en Inbox)
-- Idempotente: ejecutar en Supabase SQL Editor

ALTER TABLE leads ADD COLUMN IF NOT EXISTS boceto_aceptado BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS boceto_aceptado_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_boceto_aceptado
  ON leads(boceto_aceptado)
  WHERE boceto_aceptado = true;

ALTER TABLE leads_apex_next ADD COLUMN IF NOT EXISTS boceto_aceptado BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leads_apex_next ADD COLUMN IF NOT EXISTS boceto_aceptado_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_apex_next_boceto_aceptado
  ON leads_apex_next(boceto_aceptado)
  WHERE boceto_aceptado = true;
