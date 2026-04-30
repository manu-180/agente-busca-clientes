-- Migración: Evolution Pool — round-robin LRU + onboarding premium
-- Fecha: 2026-04-29
-- Project: hpbxscfbnhspeckdmkvu
-- Sesión: SESSION-EVO-04
-- Aplicada via MCP Supabase (apply_migration name=evolution_pool_session_evo_04)

-- 1. Agregar 'evolution' al CHECK constraint de provider
--    (originalmente solo permitía 'twilio' y 'wassenger')
ALTER TABLE senders DROP CONSTRAINT IF EXISTS senders_provider_check;
ALTER TABLE senders
  ADD CONSTRAINT senders_provider_check
  CHECK (provider = ANY (ARRAY['twilio'::text, 'wassenger'::text, 'evolution'::text]));

-- 2. Columnas nuevas para el pool round-robin LRU
ALTER TABLE senders
  ADD COLUMN IF NOT EXISTS daily_limit INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS msgs_today INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reset_date DATE,
  ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS connected BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qr_requested_at TIMESTAMPTZ;

-- 3. Índice para selectNextSender (LRU least-used)
CREATE INDEX IF NOT EXISTS idx_senders_pool_lookup
  ON senders (provider, activo, connected, msgs_today, last_sent_at)
  WHERE provider = 'evolution';

COMMENT ON COLUMN senders.msgs_today IS
  'Reemplaza configuracion[<instance>_primer_enviados_hoy]. Reset diario en cron al inicio del tick.';
