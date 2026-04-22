-- Sincroniza límite diario de primer contacto (UI) con el código: 50 por sender
-- Idempotente: ejecutar en Supabase SQL editor una vez tras deploy.
INSERT INTO configuracion (clave, valor) VALUES
  ('first_contact_limite_diario', '50')
ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor;
