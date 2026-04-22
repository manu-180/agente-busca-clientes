-- =============================================
-- APEX LEADS - Cola de Primer Contacto (outbound automation)
-- Script idempotente: se puede ejecutar varias veces sin efectos secundarios
-- =============================================

-- 1. Nuevas columnas en leads_apex_next para el flujo de primer contacto
ALTER TABLE leads_apex_next
  ADD COLUMN IF NOT EXISTS mensaje_enviado BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE leads_apex_next
  ADD COLUMN IF NOT EXISTS video_enviado BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE leads_apex_next
  ADD COLUMN IF NOT EXISTS primer_envio_intentos INT NOT NULL DEFAULT 0;

ALTER TABLE leads_apex_next
  ADD COLUMN IF NOT EXISTS primer_envio_error TEXT;

ALTER TABLE leads_apex_next
  ADD COLUMN IF NOT EXISTS primer_envio_completado_at TIMESTAMPTZ;

-- Marcar como ya completados los leads outbound históricos
-- (los que ya tienen conversaciones enviadas) para que el cron no los procese
UPDATE leads_apex_next
SET
  mensaje_enviado = true,
  video_enviado = true,
  primer_envio_completado_at = COALESCE(primer_envio_completado_at, created_at)
WHERE origen = 'outbound'
  AND mensaje_enviado = false
  AND (
    estado != 'pendiente'
    OR EXISTS (
      SELECT 1 FROM conversaciones c
      WHERE c.lead_id = leads_apex_next.id
      LIMIT 1
    )
  );

-- 2. Índices para la cola (leads pendientes de primer contacto)
CREATE INDEX IF NOT EXISTS idx_leads_cola_primer_contacto
  ON leads_apex_next (created_at)
  WHERE origen = 'outbound'
    AND mensaje_enviado = false
    AND estado = 'pendiente';

CREATE INDEX IF NOT EXISTS idx_leads_primer_envio_completado_at
  ON leads_apex_next (primer_envio_completado_at)
  WHERE primer_envio_completado_at IS NOT NULL;

-- 3. Valores de configuración por defecto (si no existen)
INSERT INTO configuracion (clave, valor) VALUES
  ('first_contact_activo', 'true'),
  ('first_contact_limite_diario', '30'),
  ('first_contact_ventana_horaria_activa', 'false'),
  ('first_contact_hora_inicio', '9'),
  ('first_contact_hora_fin', '21'),
  ('first_contact_intervalo_min_min', '10'),
  ('first_contact_intervalo_max_min', '15'),
  ('first_contact_next_slot_at', '1970-01-01T00:00:00.000Z'),
  ('first_contact_max_reintentos', '3')
ON CONFLICT (clave) DO NOTHING;

-- 4. Verificación visual (debe devolver 5 filas de columnas y 8 de config)
SELECT 'columna_nueva' AS tipo, column_name AS nombre
FROM information_schema.columns
WHERE table_name = 'leads_apex_next'
  AND column_name IN (
    'mensaje_enviado', 'video_enviado',
    'primer_envio_intentos', 'primer_envio_error',
    'primer_envio_completado_at'
  )
UNION ALL
SELECT 'config' AS tipo, clave AS nombre
FROM configuracion
WHERE clave LIKE 'first_contact_%'
ORDER BY tipo, nombre;
