-- Migration: trabajos & cuotas
-- Track client contracts, installments and payment status

CREATE TABLE IF NOT EXISTS trabajos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        TEXT NOT NULL,
  cliente       TEXT,
  descripcion   TEXT,
  tipo          TEXT NOT NULL DEFAULT 'cuotas' CHECK (tipo IN ('cuotas', 'indefinido')),
  valor_cuota   NUMERIC(12,2) NOT NULL DEFAULT 0,
  moneda        TEXT NOT NULL DEFAULT 'ARS',
  total_cuotas  INTEGER,        -- NULL = indefinido
  fecha_inicio  DATE NOT NULL DEFAULT CURRENT_DATE,
  activo        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cuotas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trabajo_id        UUID NOT NULL REFERENCES trabajos(id) ON DELETE CASCADE,
  numero_cuota      INTEGER NOT NULL,
  valor             NUMERIC(12,2) NOT NULL,
  fecha_vencimiento DATE,
  pagado            BOOLEAN NOT NULL DEFAULT false,
  fecha_pago        DATE,
  notas             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cuotas_trabajo_id        ON cuotas(trabajo_id);
CREATE INDEX IF NOT EXISTS idx_cuotas_fecha_vencimiento ON cuotas(fecha_vencimiento);
CREATE INDEX IF NOT EXISTS idx_cuotas_pagado            ON cuotas(pagado);
CREATE INDEX IF NOT EXISTS idx_trabajos_activo          ON trabajos(activo);

-- Reuse update_updated_at_column if it already exists, otherwise create it
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    EXECUTE $f$
      CREATE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $inner$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $inner$ LANGUAGE plpgsql;
    $f$;
  END IF;
END $$;

CREATE TRIGGER update_trabajos_updated_at
  BEFORE UPDATE ON trabajos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cuotas_updated_at
  BEFORE UPDATE ON cuotas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE trabajos ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuotas   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_trabajos" ON trabajos FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_cuotas"   ON cuotas   FOR ALL USING (true) WITH CHECK (true);
