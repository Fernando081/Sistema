ALTER TABLE crm_solicitud_web ADD COLUMN id_oportunidad integer UNIQUE
  REFERENCES crm_oportunidad(id_oportunidad);
CREATE TABLE crm_oportunidad_consulta_web (
  id_oportunidad integer PRIMARY KEY REFERENCES crm_oportunidad(id_oportunidad),
  request_id uuid NOT NULL UNIQUE REFERENCES crm_solicitud_web(request_id),
  piezas jsonb NOT NULL CHECK (jsonb_typeof(piezas)='array' AND jsonb_array_length(piezas) BETWEEN 1 AND 10),
  id_autor integer NOT NULL REFERENCES auth_user(id_user),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
