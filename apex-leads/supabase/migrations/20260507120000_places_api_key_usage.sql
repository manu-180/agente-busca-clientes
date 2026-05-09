-- ─── Google Places API key rotation: usage counter por mes ───────────────────
-- Cada API key configurada (env GOOGLE_PLACES_API_KEY, _2, _3, ...) tiene un
-- cupo gratuito mensual recurrente de Google (1000 calls/mes en SKU
-- "Text Search Enterprise", el tier que dispara `websiteUri`).
-- Cuenta por (key_label, month_yyyymm) y devuelve cuánto se usó en el mes.
-- El "mes" se calcula en hora del Pacífico de EE.UU. para alinearse con el
-- reset de Google (medianoche PT del día 1).
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS places_api_key_usage (
  key_label       text        NOT NULL,
  month_yyyymm    text        NOT NULL,           -- "YYYY-MM" en zona PT
  requests_used   integer     NOT NULL DEFAULT 0,
  monthly_quota   integer     NOT NULL DEFAULT 1000,
  last_used_at    timestamptz,
  last_error      text,
  last_error_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key_label, month_yyyymm)
);

COMMENT ON TABLE  places_api_key_usage IS 'Contador mensual de requests a Google Places API por env key (rotación de cuotas)';
COMMENT ON COLUMN places_api_key_usage.key_label    IS 'Nombre de la env var: GOOGLE_PLACES_API_KEY, GOOGLE_PLACES_API_KEY_2, ...';
COMMENT ON COLUMN places_api_key_usage.month_yyyymm IS 'Mes calendario en hora Pacífico (YYYY-MM)';
COMMENT ON COLUMN places_api_key_usage.monthly_quota IS 'Tope gratuito mensual del SKU (Text Search Enterprise = 1000)';

-- ─── RPC consume_places_quota ────────────────────────────────────────────────
-- Atómico: incrementa requests_used solo si está dentro del cupo. Devuelve el
-- valor nuevo, o NULL si la key ya quemó su cuota mensual.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION consume_places_quota(
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
  VALUES (p_label, p_month, 0, p_quota, now(), now())
  ON CONFLICT (key_label, month_yyyymm) DO NOTHING;

  UPDATE places_api_key_usage
     SET requests_used = requests_used + 1,
         last_used_at  = now(),
         updated_at    = now()
   WHERE key_label    = p_label
     AND month_yyyymm = p_month
     AND requests_used < monthly_quota
  RETURNING requests_used INTO v_used;

  RETURN v_used;  -- NULL si la key ya quemó cuota (UPDATE no afectó filas)
END;
$$;

-- ─── RPC mark_places_quota_error ─────────────────────────────────────────────
-- Anota el último error contra una key (sin tocar el contador).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_places_quota_error(
  p_label text,
  p_month text,
  p_quota integer,
  p_error text
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO places_api_key_usage (key_label, month_yyyymm, monthly_quota, last_error, last_error_at, updated_at)
  VALUES (p_label, p_month, p_quota, p_error, now(), now())
  ON CONFLICT (key_label, month_yyyymm) DO UPDATE
    SET last_error    = EXCLUDED.last_error,
        last_error_at = EXCLUDED.last_error_at,
        updated_at    = now();
END;
$$;
