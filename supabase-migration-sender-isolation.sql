-- =============================================
-- APEX LEADS - Sender Isolation
-- Garantiza que cada lead quede atado a un sender
-- específico para que las respuestas nunca mezclen canales.
-- Idempotente: safe to run multiple times
-- =============================================

-- ─── 1. sender_id en tabla leads ──────────────────────────────────────────────
-- Registra con qué sender se inició la conversación con este lead.
-- Una vez asignado, SIEMPRE se usa ese sender para responder.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'leads'
  ) THEN
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS sender_id UUID REFERENCES senders(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Índice para el lookup por sender (útil para stats y filtros)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'leads' AND indexname = 'idx_leads_sender_id'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'leads'
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_leads_sender_id ON leads(sender_id) WHERE sender_id IS NOT NULL';
    END IF;
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

-- ─── 2. Retroactivo: asignar sender_id a leads existentes ────────────────────
-- Para cada lead que aún no tiene sender_id, tomamos el sender
-- del PRIMER mensaje del cliente (rol = 'cliente') con sender_id no nulo.
-- Esto respeta el canal original por el que el contacto llegó.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'sender_id'
  ) THEN
    UPDATE leads l
    SET sender_id = sub.sender_id
    FROM (
      SELECT DISTINCT ON (lead_id)
        lead_id,
        sender_id
      FROM conversaciones
      WHERE
        rol = 'cliente'
        AND sender_id IS NOT NULL
        AND lead_id IS NOT NULL
      ORDER BY lead_id, "timestamp" ASC
    ) sub
    WHERE l.id = sub.lead_id
      AND l.sender_id IS NULL;
  END IF;
END $$;
