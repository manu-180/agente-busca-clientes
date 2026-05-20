-- ─── Google Places API key rotation: robustez ────────────────────────────────
-- Cambios:
--   1) record_places_call: incrementa el contador SIN cap, para que se llame
--      DESPUÉS de un fetch 2xx (los errores 403/4xx/5xx no consumen cuota).
--   2) reset_places_key_month: re-habilita una key marcada como agotada
--      para el mes actual (botón "Re-habilitar" en la UI).
-- ----------------------------------------------------------------------------

-- ─── RPC record_places_call ──────────────────────────────────────────────────
-- A diferencia de consume_places_quota (que valida cupo), este RPC SIEMPRE
-- incrementa el contador. Pensado para llamarse solo después de un 2xx real
-- de Google Places, donde la cuota ya se consumió "en Google" lo querramos
-- contar o no. Mantenemos consume_places_quota porque otros consumidores
-- pueden seguir usándolo, pero search.ts pasa a usar este.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_places_call(
  p_label text,
  p_month text,
  p_quota integer
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_used integer;
BEGIN
  INSERT INTO places_api_key_usage (key_label, month_yyyymm, requests_used, monthly_quota, last_used_at, updated_at)
  VALUES (p_label, p_month, 1, p_quota, now(), now())
  ON CONFLICT (key_label, month_yyyymm) DO UPDATE
    SET requests_used = places_api_key_usage.requests_used + 1,
        monthly_quota = EXCLUDED.monthly_quota,
        last_used_at  = now(),
        updated_at    = now()
  RETURNING requests_used INTO v_used;

  RETURN v_used;
END;
$$;

COMMENT ON FUNCTION record_places_call IS 'Incrementa requests_used SIN validar cupo. Llamar solo después de un 2xx real de Google Places.';

-- ─── RPC reset_places_key_month ──────────────────────────────────────────────
-- Re-habilita una key agotada para el mes actual. Pone requests_used = 0 y
-- limpia el último error. Usado por el botón "Re-habilitar" en la UI cuando
-- el usuario sabe que la key volvió a tener cupo (ej. billing reactivado).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reset_places_key_month(
  p_label text,
  p_month text
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE places_api_key_usage
     SET requests_used = 0,
         last_error    = NULL,
         last_error_at = NULL,
         updated_at    = now()
   WHERE key_label    = p_label
     AND month_yyyymm = p_month;
END;
$$;

COMMENT ON FUNCTION reset_places_key_month IS 'Pone requests_used = 0 y limpia last_error para una (key_label, mes) específico. Operación manual desde la UI.';
