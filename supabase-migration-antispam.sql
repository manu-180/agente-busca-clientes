-- ─── Anti-spam: bloqueos a nivel DB para no volver a contactar teléfonos ya usados ──────────────
-- Ejecutar en Supabase SQL Editor

-- 1. Eliminar leads duplicados sin enviar, manteniendo el más nuevo por teléfono.
--    Si hay varios leads pendientes con el mismo tel, conserva el más reciente.
DELETE FROM leads
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY telefono ORDER BY created_at DESC) AS rn
    FROM leads
    WHERE telefono IS NOT NULL AND telefono != ''
      AND mensaje_enviado = false
  ) sub
  WHERE rn > 1
);

-- Lo mismo para leads_apex_next (por si existe)
DELETE FROM leads_apex_next
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY telefono ORDER BY created_at DESC) AS rn
    FROM leads_apex_next
    WHERE telefono IS NOT NULL AND telefono != ''
      AND mensaje_enviado = false
  ) sub
  WHERE rn > 1
);

-- 2. Índice único parcial: un teléfono activo (pendiente) solo puede aparecer una vez.
--    Leads ya enviados/descartados no entran en el constraint para no romper el histórico.
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_telefono_pendiente_unique
  ON leads(telefono)
  WHERE telefono IS NOT NULL
    AND telefono != ''
    AND mensaje_enviado = false
    AND estado = 'pendiente';

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_apex_next_telefono_pendiente_unique
  ON leads_apex_next(telefono)
  WHERE telefono IS NOT NULL
    AND telefono != ''
    AND mensaje_enviado = false
    AND estado = 'pendiente';

-- 3. Función: devuelve true si el teléfono ya fue contactado (leads o conversaciones).
--    El cron puede llamarla antes de enviar como validación extra.
CREATE OR REPLACE FUNCTION telefono_ya_contactado(p_tel TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversaciones WHERE telefono = p_tel LIMIT 1
  ) OR EXISTS (
    SELECT 1 FROM leads WHERE telefono = p_tel AND mensaje_enviado = true LIMIT 1
  );
$$;

-- 4. Trigger: bloquea el INSERT/UPDATE de un lead a estado 'pendiente'
--    si ese teléfono ya tiene conversaciones (ya fue contactado antes).
CREATE OR REPLACE FUNCTION bloquear_lead_duplicado()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.telefono IS NOT NULL AND NEW.telefono != ''
     AND NEW.mensaje_enviado = false
     AND NEW.estado = 'pendiente' THEN

    -- Verificar en conversaciones
    IF EXISTS (
      SELECT 1 FROM conversaciones WHERE telefono = NEW.telefono LIMIT 1
    ) THEN
      RAISE EXCEPTION 'LEAD_DUPLICADO: teléfono % ya tiene conversaciones previas', NEW.telefono;
    END IF;

    -- Verificar en leads (otro lead ya enviado con mismo tel)
    IF EXISTS (
      SELECT 1 FROM leads
      WHERE telefono = NEW.telefono
        AND mensaje_enviado = true
        AND id IS DISTINCT FROM NEW.id
      LIMIT 1
    ) THEN
      RAISE EXCEPTION 'LEAD_DUPLICADO: teléfono % ya fue contactado por otro lead', NEW.telefono;
    END IF;

  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bloquear_lead_duplicado ON leads;
CREATE TRIGGER trg_bloquear_lead_duplicado
  BEFORE INSERT OR UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION bloquear_lead_duplicado();

-- El mismo trigger para leads_apex_next
CREATE OR REPLACE FUNCTION bloquear_lead_duplicado_apex_next()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.telefono IS NOT NULL AND NEW.telefono != ''
     AND NEW.mensaje_enviado = false
     AND NEW.estado = 'pendiente' THEN

    IF EXISTS (
      SELECT 1 FROM conversaciones WHERE telefono = NEW.telefono LIMIT 1
    ) THEN
      RAISE EXCEPTION 'LEAD_DUPLICADO: teléfono % ya tiene conversaciones previas', NEW.telefono;
    END IF;

    IF EXISTS (
      SELECT 1 FROM leads_apex_next
      WHERE telefono = NEW.telefono
        AND mensaje_enviado = true
        AND id IS DISTINCT FROM NEW.id
      LIMIT 1
    ) THEN
      RAISE EXCEPTION 'LEAD_DUPLICADO: teléfono % ya fue contactado', NEW.telefono;
    END IF;

  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bloquear_lead_duplicado_apex_next ON leads_apex_next;
CREATE TRIGGER trg_bloquear_lead_duplicado_apex_next
  BEFORE INSERT OR UPDATE ON leads_apex_next
  FOR EACH ROW EXECUTE FUNCTION bloquear_lead_duplicado_apex_next();
