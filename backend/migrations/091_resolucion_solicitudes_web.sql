-- Decisiones administrativas: conserva original, sin guardar contactos ni huellas.
CREATE TABLE crm_solicitud_web_resolucion (
  operation_id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES crm_solicitud_web(request_id),
  motivo varchar(20) NOT NULL CHECK (motivo IN ('Contenido','Catalogo','Clave','Confirmacion')),
  decision varchar(24) NOT NULL DEFAULT 'ConservarOriginal' CHECK (decision='ConservarOriginal'),
  expected_version integer NOT NULL CHECK (expected_version>0),
  version_resultante integer NOT NULL CHECK (version_resultante=expected_version+1),
  contenido varchar(12) NOT NULL CHECK (contenido IN ('Vigente','Vencido','Purgado')),
  id_oportunidad integer REFERENCES crm_oportunidad(id_oportunidad),
  id_autor integer NOT NULL REFERENCES auth_user(id_user),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(request_id,version_resultante)
);
CREATE INDEX crm_solicitud_web_resolucion_historial
  ON crm_solicitud_web_resolucion(request_id,version_resultante DESC);

CREATE FUNCTION fn_resolucion_web_solo_insercion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Las decisiones de solicitudes web no se editan ni se eliminan' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER resolucion_web_solo_insercion BEFORE UPDATE OR DELETE
  ON crm_solicitud_web_resolucion FOR EACH ROW EXECUTE FUNCTION fn_resolucion_web_solo_insercion();
