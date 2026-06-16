-- Jitter anti-ban: columna que bloquea el sender hasta que venza su cooldown
-- aleatorio post-envío. Permite que el cron elija otros senders mientras éste
-- descansa, creando patrones de envío irregulares (menos detectables como bot).
ALTER TABLE public.senders
  ADD COLUMN IF NOT EXISTS send_cooldown_until TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.senders.send_cooldown_until IS
  'Timestamp hasta el que este sender no debe ser elegido por selectNextSender. '
  'Se setea a now() + jitter aleatorio (2-12 min) tras cada envío exitoso. '
  'NULL = sin cooldown activo (disponible de inmediato).';
