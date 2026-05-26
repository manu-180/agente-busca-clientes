-- ─── Google Places API key aliases ─────────────────────────────────────────
-- Alias amigable por key_label (ej: "Cuenta camila", "Cuenta botlode") para
-- que el usuario sepa de qué cuenta de Google viene cada slot, sin tener que
-- recordar los 4 chars del sufijo.
--
-- Una sola fila por key_label (NO depende del mes — el alias persiste).
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS places_api_key_alias (
  key_label   text         PRIMARY KEY,
  alias       text         NOT NULL,
  updated_at  timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE  places_api_key_alias IS 'Alias humano por env-var de API key (ej: GOOGLE_PLACES_API_KEY → "Cuenta camila").';
COMMENT ON COLUMN places_api_key_alias.key_label IS 'Coincide con places_api_key_usage.key_label (GOOGLE_PLACES_API_KEY, _2, _3, ...).';
COMMENT ON COLUMN places_api_key_alias.alias     IS 'Texto libre que muestra la UI en lugar/encima del título genérico "Key #N".';

-- ─── RPC upsert_places_key_alias ─────────────────────────────────────────────
-- Upsert atómico: crea o actualiza el alias de una key_label. Si alias viene
-- vacío/null, BORRA la fila (volvés al título genérico de la UI).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION upsert_places_key_alias(
  p_label text,
  p_alias text
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_alias IS NULL OR length(trim(p_alias)) = 0 THEN
    DELETE FROM places_api_key_alias WHERE key_label = p_label;
    RETURN;
  END IF;

  INSERT INTO places_api_key_alias (key_label, alias, updated_at)
  VALUES (p_label, trim(p_alias), now())
  ON CONFLICT (key_label) DO UPDATE
    SET alias      = EXCLUDED.alias,
        updated_at = now();
END;
$$;

COMMENT ON FUNCTION upsert_places_key_alias IS 'Crea/actualiza el alias de una API key. Alias vacío borra la fila.';
