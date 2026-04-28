-- Agrega timestamp de fallo en primer contacto para stats de "Fallidos hoy"
ALTER TABLE leads ADD COLUMN IF NOT EXISTS primer_envio_fallido_at TIMESTAMPTZ;

-- Índice para queries de stats diarias
CREATE INDEX IF NOT EXISTS leads_primer_envio_fallido_at_idx ON leads (primer_envio_fallido_at)
  WHERE primer_envio_fallido_at IS NOT NULL;
