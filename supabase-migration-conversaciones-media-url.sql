-- Adjuntos Twilio (WhatsApp): URL del primer medio para reproducir/ver en Inbox.
-- Idempotente.

ALTER TABLE public.conversaciones ADD COLUMN IF NOT EXISTS media_url TEXT;

COMMENT ON COLUMN public.conversaciones.media_url IS
  'URL API de Twilio del adjunto (MediaUrl0). Requiere proxy /api/conversaciones/media con credenciales.';

-- Las vistas usan * expandido al crearlas: refrescar tras nueva columna.
CREATE OR REPLACE VIEW public.conversaciones_ultima_por_lead AS
SELECT DISTINCT ON (lead_id) *
FROM public.conversaciones
WHERE lead_id IS NOT NULL
ORDER BY lead_id, "timestamp" DESC;

CREATE OR REPLACE VIEW public.conversaciones_primera_por_lead AS
SELECT DISTINCT ON (lead_id) *
FROM public.conversaciones
WHERE lead_id IS NOT NULL
ORDER BY lead_id, "timestamp" ASC;
