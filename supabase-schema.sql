-- =============================================
-- APEX LEADS - Schema SQL
-- Ejecutar esto en Supabase SQL Editor
-- Script idempotente: se puede ejecutar varias veces
-- =============================================

-- Tipos enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_lead') THEN
    CREATE TYPE estado_lead AS ENUM (
      'pendiente', 'contactado', 'respondio',
      'interesado', 'cerrado', 'descartado', 'no_interesado'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'origen_lead') THEN
    CREATE TYPE origen_lead AS ENUM ('outbound', 'inbound');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rol_mensaje') THEN
    CREATE TYPE rol_mensaje AS ENUM ('agente', 'cliente');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_mensaje') THEN
    CREATE TYPE tipo_mensaje AS ENUM ('texto', 'audio', 'imagen', 'otro');
  END IF;
END $$;

-- Tabla leads_apex_next
CREATE TABLE IF NOT EXISTS leads_apex_next (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre TEXT NOT NULL,
  rubro TEXT NOT NULL,
  zona TEXT NOT NULL DEFAULT 'Buenos Aires',
  telefono TEXT NOT NULL,
  instagram TEXT,
  descripcion TEXT NOT NULL DEFAULT '',
  mensaje_inicial TEXT NOT NULL DEFAULT '',
  estado estado_lead NOT NULL DEFAULT 'pendiente',
  origen origen_lead NOT NULL DEFAULT 'outbound',
  agente_activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notas TEXT
);

-- Tabla conversaciones
CREATE TABLE IF NOT EXISTS conversaciones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads_apex_next(id) ON DELETE CASCADE,
  telefono TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  rol rol_mensaje NOT NULL,
  tipo_mensaje tipo_mensaje NOT NULL DEFAULT 'texto',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  leido BOOLEAN NOT NULL DEFAULT false
);

-- Tabla apex_info (conocimiento del agente)
CREATE TABLE IF NOT EXISTS apex_info (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  categoria TEXT NOT NULL,
  titulo TEXT NOT NULL,
  contenido TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabla configuracion
CREATE TABLE IF NOT EXISTS configuracion (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clave TEXT UNIQUE NOT NULL,
  valor TEXT NOT NULL
);

-- Asegurar columnas si las tablas ya existían con otra estructura
ALTER TABLE leads_apex_next ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
ALTER TABLE leads_apex_next ADD COLUMN IF NOT EXISTS nombre TEXT;
ALTER TABLE leads_apex_next ADD COLUMN IF NOT EXISTS rubro TEXT;
ALTER TABLE leads_apex_next ADD COLUMN IF NOT EXISTS zona TEXT DEFAULT 'Buenos Aires';
ALTER TABLE leads_apex_next ADD COLUMN IF NOT EXISTS telefono TEXT;
ALTER TABLE leads_apex_next ADD COLUMN IF NOT EXISTS instagram TEXT;
ALTER TABLE leads_apex_next ADD COLUMN IF NOT EXISTS descripcion TEXT DEFAULT '';
ALTER TABLE leads_apex_next ADD COLUMN IF NOT EXISTS mensaje_inicial TEXT DEFAULT '';
ALTER TABLE leads_apex_next ADD COLUMN IF NOT EXISTS estado estado_lead DEFAULT 'pendiente';
ALTER TABLE leads_apex_next ADD COLUMN IF NOT EXISTS origen origen_lead DEFAULT 'outbound';
ALTER TABLE leads_apex_next ADD COLUMN IF NOT EXISTS agente_activo BOOLEAN DEFAULT true;
ALTER TABLE leads_apex_next ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE leads_apex_next ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE leads_apex_next ADD COLUMN IF NOT EXISTS notas TEXT;

ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS lead_id UUID;
ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS telefono TEXT;
ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS mensaje TEXT;
ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS rol rol_mensaje;
ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS tipo_mensaje tipo_mensaje DEFAULT 'texto';
ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ DEFAULT now();
ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS leido BOOLEAN DEFAULT false;

ALTER TABLE apex_info ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
ALTER TABLE apex_info ADD COLUMN IF NOT EXISTS categoria TEXT;
ALTER TABLE apex_info ADD COLUMN IF NOT EXISTS titulo TEXT;
ALTER TABLE apex_info ADD COLUMN IF NOT EXISTS contenido TEXT;
ALTER TABLE apex_info ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT true;
ALTER TABLE apex_info ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS clave TEXT;
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS valor TEXT;

-- Endurecer defaults y restricciones para columnas clave
ALTER TABLE leads_apex_next ALTER COLUMN estado SET DEFAULT 'pendiente';
ALTER TABLE leads_apex_next ALTER COLUMN origen SET DEFAULT 'outbound';
ALTER TABLE leads_apex_next ALTER COLUMN agente_activo SET DEFAULT true;
ALTER TABLE leads_apex_next ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE leads_apex_next ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE conversaciones ALTER COLUMN tipo_mensaje SET DEFAULT 'texto';
ALTER TABLE conversaciones ALTER COLUMN timestamp SET DEFAULT now();
ALTER TABLE conversaciones ALTER COLUMN leido SET DEFAULT false;

-- Índices
CREATE INDEX IF NOT EXISTS idx_leads_apex_next_estado ON leads_apex_next(estado);
CREATE INDEX IF NOT EXISTS idx_leads_apex_next_telefono ON leads_apex_next(telefono);
CREATE INDEX IF NOT EXISTS idx_leads_apex_next_origen ON leads_apex_next(origen);
CREATE INDEX IF NOT EXISTS idx_conversaciones_lead_id ON conversaciones(lead_id);
CREATE INDEX IF NOT EXISTS idx_conversaciones_telefono ON conversaciones(telefono);
CREATE INDEX IF NOT EXISTS idx_conversaciones_timestamp ON conversaciones(timestamp DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_configuracion_clave_unique ON configuracion(clave);

-- Trigger para updated_at automático
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'leads_apex_next_updated_at'
  ) THEN
    CREATE TRIGGER leads_apex_next_updated_at
      BEFORE UPDATE ON leads_apex_next
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- Row Level Security
ALTER TABLE leads_apex_next ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE apex_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracion ENABLE ROW LEVEL SECURITY;

-- Políticas: acceso total con service_role
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'leads_apex_next'
      AND policyname = 'service_role_all_leads_apex_next'
  ) THEN
    CREATE POLICY "service_role_all_leads_apex_next" ON leads_apex_next
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'conversaciones'
      AND policyname = 'service_role_all_conversaciones'
  ) THEN
    CREATE POLICY "service_role_all_conversaciones" ON conversaciones
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'apex_info'
      AND policyname = 'service_role_all_apex_info'
  ) THEN
    CREATE POLICY "service_role_all_apex_info" ON apex_info
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'configuracion'
      AND policyname = 'service_role_all_configuracion'
  ) THEN
    CREATE POLICY "service_role_all_configuracion" ON configuracion
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Habilitar Realtime para conversaciones
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'conversaciones'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE conversaciones;
  END IF;
END $$;

-- Datos iniciales de configuración
INSERT INTO configuracion (clave, valor) VALUES
  ('agente_activo', 'true'),
  ('max_mensajes_dia', '20'),
  ('horario_inicio', '09:00'),
  ('horario_fin', '21:00')
ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor;

-- Info pre-cargada de APEX (ejemplos para editar)
INSERT INTO apex_info (categoria, titulo, contenido)
SELECT v.categoria, v.titulo, v.contenido
FROM (
  VALUES
    ('servicios', 'Servicios principales',
     'Desarrollo de sitios web profesionales, landing pages de alta conversión, tiendas online (e-commerce), y aplicaciones móviles. Todo custom, nada de templates.'),
    ('precios', 'Rangos de precios',
     'Landing page desde USD 200. Sitio web completo desde USD 400. E-commerce desde USD 600. App móvil desde USD 1500. Incluye diseño, desarrollo y puesta en marcha.'),
    ('proceso', 'Cómo trabajamos',
     '1. Te hacemos un boceto gratuito en 24 horas para que veas cómo quedaría tu sitio. 2. Si te gusta, coordinamos el primer pago (50%) y arrancamos. 3. Entrega en 2-4 semanas según complejidad. 4. Revisiones incluidas hasta que quedes conforme.'),
    ('portfolio', 'Trabajos realizados',
     'Podés ver nuestros trabajos en theapexweb.com. Trabajamos con talleres mecánicos, spas, gimnasios, nutricionistas, tiendas online y más.'),
    ('faqs', 'Preguntas frecuentes',
     '¿Cuánto tarda? Entre 2 y 4 semanas. ¿Puedo pagar en cuotas? Sí, 50% al arrancar y 50% al entregar. ¿Incluye hosting? Sí, el primer año. ¿Puedo editarlo después? Sí, te dejamos un panel de administración. ¿Qué pasa si no me gusta el boceto? No pagás nada, sin compromiso.'),
    ('diferencial', 'Por qué APEX',
     'No somos una agencia genérica. Cada sitio es diseñado desde cero para tu negocio. Usamos tecnología moderna (no WordPress). Tu sitio carga rápido, se ve profesional y está optimizado para que te encuentren en Google. Además, arrancamos con un boceto gratuito sin compromiso.')
) AS v(categoria, titulo, contenido)
WHERE NOT EXISTS (
  SELECT 1 FROM apex_info a WHERE a.titulo = v.titulo
);
