-- Bandeja privada; no habilita recopilación pública ni conexiones externas.
CREATE TABLE crm_solicitud_web (
  request_id uuid PRIMARY KEY,
  fingerprint varchar(64) NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  payload jsonb,
  estado varchar(20) NOT NULL DEFAULT 'Pendiente' CHECK (estado IN ('Pendiente','Revisada','Descartada')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '90 days',
  revisada_por integer REFERENCES auth_user(id_user),
  CHECK (payload IS NULL OR (jsonb_typeof(payload) = 'object' AND payload->>'origin' = 'public-web'))
);
CREATE INDEX crm_solicitud_web_pendientes ON crm_solicitud_web(estado, created_at DESC);
CREATE INDEX crm_solicitud_web_retencion ON crm_solicitud_web(expires_at) WHERE payload IS NOT NULL;
