-- ─── Sender lifecycle (Fase 1: frenar el sangrado + reponer solo) ────────────
-- Agrega una máquina de estados explícita a `senders` para el cold outreach por
-- WhatsApp (Evolution). Hoy el estado se deriva de flags sueltos (activo/connected)
-- y cuando un número se banea queda "zombie" (activo=true, connected=false) sin
-- que nadie reponga. Esta columna `status` hace explícito el ciclo de vida:
--
--   reserve  → chip vinculado y conectado, esperando turno (capacidad de reserva).
--   warming  → chip nuevo en ramp-up (daily_limit sube gradual; ver sender-lifecycle.ts).
--   active   → chip maduro, en el pool de envío a tope.
--   banned   → WhatsApp lo baneó (device_removed/code_403). Terminal: NO reintentar revivir.
--   archived → retirado a mano (los 18 viejos que el usuario descarta). Terminal.
--
-- La integración de `status` en `selectNextSender` y el cron es Fase 2; esta
-- migración solo agrega columnas + backfill conservador. NO apaga el número vivo.
-- ----------------------------------------------------------------------------

-- Estado del ciclo de vida del sender. Default 'active' para que filas nuevas o
-- sin clasificar entren al pool como hasta ahora (back-compat con el código viejo
-- que solo mira activo/connected).
ALTER TABLE public.senders
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('reserve', 'warming', 'active', 'banned', 'archived'));

-- Momento en que el chip arrancó el warming ramp. NULL = nunca estuvo en warming.
-- El daily_limit efectivo durante warming se calcula por días transcurridos desde
-- acá (ver warmingDailyLimit en src/lib/sender-lifecycle.ts).
ALTER TABLE public.senders
  ADD COLUMN IF NOT EXISTS warmup_started_at TIMESTAMPTZ;

-- Techo del ramp de warming: a dónde sube daily_limit cuando el warming termina.
-- Default 30 (volumen conservador maduro). El ramp nunca supera este valor.
ALTER TABLE public.senders
  ADD COLUMN IF NOT EXISTS daily_limit_target INTEGER NOT NULL DEFAULT 30;

-- Momento del baneo (status='banned'). Se backfillea desde disconnected_at para
-- los que ya cayeron por device_removed/code_403.
ALTER TABLE public.senders
  ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;

-- Razón del baneo (código corto: 'device_removed', 'code_403'). Se backfillea
-- desde disconnection_reason.
ALTER TABLE public.senders
  ADD COLUMN IF NOT EXISTS ban_reason TEXT;

COMMENT ON COLUMN public.senders.status IS
  'Ciclo de vida: reserve|warming|active|banned|archived. banned/archived son terminales (no se reintenta reconectar).';
COMMENT ON COLUMN public.senders.warmup_started_at IS
  'Inicio del warming ramp (TIMESTAMPTZ). NULL = nunca en warming. Base del cálculo de daily_limit gradual.';
COMMENT ON COLUMN public.senders.daily_limit_target IS
  'Techo del ramp de warming: daily_limit final cuando el warming completa. Default 30.';
COMMENT ON COLUMN public.senders.banned_at IS
  'Momento del baneo por WhatsApp (status=banned). Backfill desde disconnected_at.';
COMMENT ON COLUMN public.senders.ban_reason IS
  'Razón del baneo: device_removed | code_403. Backfill desde disconnection_reason.';

-- ─── Backfill conservador (orden: banned → archived → active) ────────────────
-- Filosofía: NO apagar el número vivo. Marcar lo claramente muerto (baneado),
-- archivar TODO lo que no es el número vivo, y dejar 'active' solo al vivo.
--
-- ⚠️ El orden importa y el paso 'archived' NO puede keyear por
-- `status NOT IN ('active','banned')`: la columna nace con DEFAULT 'active', así
-- que TODAS las filas arrancan 'active' y esa condición no matchearía a nadie
-- (bug detectado contra datos reales el 2026-06-15). En su lugar, archivamos por
-- activo/connected, que es la definición real de "vivo" (la misma de selectNextSender).

-- 1) BANNED: los que cayeron por baneo real de WhatsApp. Preserva el timestamp y
--    la causa originales tomándolos de las columnas de disconnection.
UPDATE public.senders
   SET status     = 'banned',
       banned_at  = COALESCE(banned_at, disconnected_at),
       ban_reason = COALESCE(ban_reason, disconnection_reason)
 WHERE provider = 'evolution'
   AND disconnection_reason IN ('device_removed', 'code_403')
   AND status <> 'banned';

-- 2) ARCHIVED: todo Evolution que NO es el número vivo (activo+connected) y que no
--    quedó banned arriba. Retira los viejos/apagados que el usuario descarta, SIN
--    depender del DEFAULT (que ya los dejó 'active'). Recuperables a mano, pero
--    fuera del pool.
UPDATE public.senders
   SET status = 'archived'
 WHERE provider = 'evolution'
   AND status <> 'banned'
   AND NOT (activo = true AND connected = true);

-- 3) ACTIVE: el/los número(s) vivo(s) (activo + connected) que NO quedaron banned.
--    Explícito e idempotente con el DEFAULT — protege "Manu celu actual", el único vivo.
UPDATE public.senders
   SET status = 'active'
 WHERE provider = 'evolution'
   AND activo = true
   AND connected = true
   AND status <> 'banned';

-- 4) ARCHIVED: los providers legacy sin uso (twilio / wassenger). Nunca entran al
--    pool de Evolution; los archivamos para que queden fuera de cualquier conteo.
UPDATE public.senders
   SET status = 'archived'
 WHERE provider IN ('twilio', 'wassenger');

-- ─── Índice de selección por status ──────────────────────────────────────────
-- Cubre la futura query de selección/promoción del pool (Fase 2): filtra por
-- provider+status+connected y ordena por msgs_today/last_sent_at (round-robin LRU).
-- Parcial sobre provider='evolution' porque es el único provider que se selecciona.
CREATE INDEX IF NOT EXISTS senders_lifecycle_idx
  ON public.senders (provider, status, connected, msgs_today, last_sent_at)
  WHERE provider = 'evolution';
