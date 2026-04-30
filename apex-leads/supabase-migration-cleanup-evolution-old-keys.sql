-- Migracion: cleanup post-Evolution-pool
-- Fecha: 2026-04-29
-- Sesion: SESSION-EVO-08
-- Borra contadores diarios y slots de cadencia que vivian en `configuracion`.
-- Reemplazados por columnas en `senders` (msgs_today, last_sent_at) desde EVO-04 + EVO-06.
-- IMPORTANTE: las claves `${instance}_primer_fallos` SE MANTIENEN — siguen usandose
-- como contador de fallos consecutivos del sender en el cron.

DELETE FROM configuracion
WHERE clave LIKE '%_primer_enviados_hoy'
   OR clave LIKE '%_primer_next_slot_at';
