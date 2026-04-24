-- Migración: Twilio message SID tracking para callbacks de status asíncronos
-- Fecha: 2026-04-23
-- Propósito: Permite correlacionar un MessageSid de Twilio con el lead correspondiente
--            cuando llega el webhook de status (undelivered/failed) para poder marcar
--            leads como descartados o resetearlos a pendiente según el error.

-- 1. Agregar columna twilio_message_sid a la tabla conversaciones
ALTER TABLE conversaciones
  ADD COLUMN IF NOT EXISTS twilio_message_sid TEXT;

-- 2. Índice parcial para búsquedas por SID (solo filas con SID asignado)
CREATE INDEX IF NOT EXISTS idx_conversaciones_twilio_sid
  ON conversaciones(twilio_message_sid)
  WHERE twilio_message_sid IS NOT NULL;
