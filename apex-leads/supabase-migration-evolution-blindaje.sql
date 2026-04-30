-- Migración: Evolution Senders — blindaje contra desconexiones
-- Fecha: 2026-04-30
-- Project: hpbxscfbnhspeckdmkvu
-- Sesión: SESSION-EVO-09 (blindaje post-incidente SIM 1)
--
-- Contexto: SIM 1 se desconectó al primer envío y APEX siguió "enviando" 11
-- mensajes más al vacío porque no detectaba la caída. Esta migration agrega
-- columnas para que webhook + cron health-check puedan registrar:
--   - razón de desconexión (device_removed, conflict, timeout, etc.)
--   - timestamp exacto de la caída
--   - última vez que un health-check verificó la instancia (fresh-staleness)
--
-- Aplicar con MCP: apply_migration name=evolution_blindaje_session_evo_09

ALTER TABLE senders
  ADD COLUMN IF NOT EXISTS disconnection_reason TEXT,
  ADD COLUMN IF NOT EXISTS disconnected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS health_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consecutive_send_failures INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN senders.disconnection_reason IS
  'Última razón de desconexión reportada por Evolution: device_removed, conflict, timeout, send_failure_threshold, etc. NULL si nunca se desconectó.';

COMMENT ON COLUMN senders.disconnected_at IS
  'Timestamp de la última transición open→close. NULL si nunca cayó.';

COMMENT ON COLUMN senders.health_checked_at IS
  'Última vez que el cron health-evolution verificó la instancia contra Evolution. Permite detectar staleness si el cron deja de correr.';

COMMENT ON COLUMN senders.consecutive_send_failures IS
  'Reemplaza configuracion[<instance>_primer_fallos]. Resetea a 0 al detectar state=open. Al llegar al umbral, marca disconnected.';

-- Índice para health-check eficiente (ordenar por staleness)
CREATE INDEX IF NOT EXISTS idx_senders_health_lookup
  ON senders (provider, activo, health_checked_at)
  WHERE provider = 'evolution';
