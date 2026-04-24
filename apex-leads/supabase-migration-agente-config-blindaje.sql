-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: blindaje de configuración del agente
-- Asegura que las claves críticas existan con valores seguros por defecto.
-- Si ya existen, NO las sobreescribe (ON CONFLICT DO NOTHING).
-- ─────────────────────────────────────────────────────────────────────────────

-- Interruptor principal del agente IA (responde mensajes entrantes)
INSERT INTO configuracion (clave, valor)
VALUES ('agente_activo', 'true')
ON CONFLICT (clave) DO NOTHING;

-- Interruptor de primer contacto outbound (cron leads-pendientes)
INSERT INTO configuracion (clave, valor)
VALUES ('first_contact_activo', 'true')
ON CONFLICT (clave) DO NOTHING;

-- Motor de decisión conversacional (false = siempre full_reply)
INSERT INTO configuracion (clave, valor)
VALUES ('decision_engine_enabled', 'true')
ON CONFLICT (clave) DO NOTHING;

-- Silenciar emojis solos (sin respuesta cuando solo mandan 👍)
INSERT INTO configuracion (clave, valor)
VALUES ('emoji_no_reply_enabled', 'true')
ON CONFLICT (clave) DO NOTHING;

-- Cerrar conversación automáticamente cuando el lead dice "gracias, hasta luego"
INSERT INTO configuracion (clave, valor)
VALUES ('conversation_auto_close_enabled', 'true')
ON CONFLICT (clave) DO NOTHING;

-- ── Verificación: mostrar estado actual de la config ─────────────────────────
SELECT clave, valor
FROM configuracion
WHERE clave IN (
  'agente_activo',
  'first_contact_activo',
  'decision_engine_enabled',
  'emoji_no_reply_enabled',
  'conversation_auto_close_enabled'
)
ORDER BY clave;

-- ── Limpiar locks atascados (procesando_hasta vencidos) ──────────────────────
UPDATE leads
SET procesando_hasta = NULL
WHERE procesando_hasta IS NOT NULL
  AND procesando_hasta < NOW() - INTERVAL '5 minutes';

-- ── Verificar leads con agente_activo = false que deberían estar activos ─────
-- (Revisar manualmente si hay muchos)
SELECT COUNT(*) AS leads_agente_inactivo
FROM leads
WHERE agente_activo = false
  AND estado NOT IN ('no_interesado', 'cerrado', 'descartado');
