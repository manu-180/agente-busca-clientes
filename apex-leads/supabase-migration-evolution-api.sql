-- Migración: Evolution API — agregar instance_name a senders
-- Ejecutar en Supabase project hpbxscfbnhspeckdmkvu
-- Fecha: 2026-04-28

-- Agregar columna instance_name para identificar la instancia Evolution API
-- que corresponde a cada fila de la tabla senders.
-- Con Twilio era null. Con Evolution API, es el nombre de la instancia (ej: 'sim01').
ALTER TABLE senders ADD COLUMN IF NOT EXISTS instance_name TEXT;

-- Indice para el lookup del webhook (busca sender por provider + instance_name)
CREATE INDEX IF NOT EXISTS idx_senders_provider_instance_name
  ON senders (provider, instance_name)
  WHERE instance_name IS NOT NULL;

-- Cuando se conecten las SIM cards (SESSION-EVO-04), insertar filas así:
--
-- INSERT INTO senders (alias, color, provider, phone_number, instance_name, activo)
-- VALUES
--   ('SIM 01', '#25D366', 'evolution', '+549XXXXXXXXXX', 'sim01', true),
--   ('SIM 02', '#128C7E', 'evolution', '+549XXXXXXXXXX', 'sim02', true);
--
-- O actualizar el sender existente de Twilio si se quiere reutilizar la fila:
--
-- UPDATE senders
-- SET provider = 'evolution', instance_name = 'sim01', phone_number = '+549XXXXXXXXXX'
-- WHERE alias = 'assistify_respaldo';
