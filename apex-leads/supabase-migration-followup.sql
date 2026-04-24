-- Ejecutar en Supabase SQL Editor (una vez) — follow-up automático + estados de lead
-- Orden: primero valores del enum, luego columna conversaciones.

-- 1) Nuevos valores de estado_lead (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'estado_lead' AND e.enumlabel = 'presupuesto_enviado'
  ) THEN
    ALTER TYPE estado_lead ADD VALUE 'presupuesto_enviado';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'estado_lead' AND e.enumlabel = 'cliente'
  ) THEN
    ALTER TYPE estado_lead ADD VALUE 'cliente';
  END IF;
END $$;

-- 2) Flag en conversaciones para mensajes de seguimiento automático
ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS es_followup BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_conversaciones_lead_followup
  ON conversaciones(lead_id) WHERE es_followup = true;
