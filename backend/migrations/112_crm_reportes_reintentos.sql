-- O01.1: cola local acotada para recuperar reportes internos; sin envíos externos.
CREATE TABLE crm_reporte_reintento (
 id_resultado uuid PRIMARY KEY REFERENCES crm_reporte_resultado(id_resultado) ON DELETE RESTRICT,
 estado varchar(12) NOT NULL DEFAULT 'Pendiente' CHECK(estado IN('Pendiente','EnCurso','Completado','Agotado','Cancelado')),
 intentos smallint NOT NULL DEFAULT 0 CHECK(intentos BETWEEN 0 AND 3),
 disponible_en timestamptz NOT NULL DEFAULT clock_timestamp(),
 token uuid, lease_hasta timestamptz, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 creada_en timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((estado='EnCurso' AND token IS NOT NULL AND lease_hasta IS NOT NULL AND intentos>0) OR
       (estado<>'EnCurso' AND token IS NULL AND lease_hasta IS NULL)),
 CHECK(estado<>'Agotado' OR intentos=3), CHECK(estado<>'Completado' OR intentos>0)
);
CREATE INDEX crm_reporte_reintento_pendiente ON crm_reporte_reintento(disponible_en,id_resultado) WHERE estado='Pendiente';
CREATE INDEX crm_reporte_reintento_lease ON crm_reporte_reintento(lease_hasta) WHERE estado='EnCurso';
CREATE TABLE crm_reporte_intento_evento (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 id_resultado uuid NOT NULL REFERENCES crm_reporte_reintento(id_resultado) ON DELETE RESTRICT,
 intento smallint NOT NULL CHECK(intento BETWEEN 0 AND 3),
 fase varchar(12) NOT NULL CHECK(fase IN('Inicio','Generado','Error','Interrumpido','Cancelado')),
 codigo varchar(40) CHECK(codigo IN('GENERACION_FALLIDA','EJECUCION_INTERRUMPIDA','AUTORIZACION_O_CONFIGURACION','CANCELADO_POR_PROPIETARIO')),
 creada_en timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(id_resultado,intento,fase),
 CHECK((fase IN('Inicio','Generado') AND codigo IS NULL) OR (fase NOT IN('Inicio','Generado') AND codigo IS NOT NULL))
);
CREATE INDEX crm_reporte_intento_historia ON crm_reporte_intento_evento(id_resultado,creada_en,id);
CREATE TABLE crm_reporte_recuperacion (
 id_resultado uuid PRIMARY KEY REFERENCES crm_reporte_reintento(id_resultado) ON DELETE RESTRICT,
 token uuid NOT NULL, generada_en timestamptz NOT NULL DEFAULT clock_timestamp(),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=8192 AND snapshot->>'version' IS NOT DISTINCT FROM '1')
);
CREATE FUNCTION fn_crm_reporte_cola_vinculo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='crm_reporte_reintento' THEN
   IF NOT EXISTS(SELECT 1 FROM crm_reporte_resultado WHERE id_resultado=NEW.id_resultado AND estado='Error') THEN
     RAISE EXCEPTION 'Sólo se recuperan resultados fallidos conservados';
   END IF;
 ELSE
   IF NOT EXISTS(SELECT 1 FROM crm_reporte_reintento WHERE id_resultado=NEW.id_resultado AND estado='EnCurso' AND token=NEW.token AND lease_hasta>clock_timestamp()) THEN
     RAISE EXCEPTION 'El intento ya no tiene autoridad para conservar el resultado';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crm_reporte_cola_vinculo BEFORE INSERT ON crm_reporte_reintento FOR EACH ROW EXECUTE FUNCTION fn_crm_reporte_cola_vinculo();
CREATE TRIGGER crm_reporte_recuperacion_vinculo BEFORE INSERT ON crm_reporte_recuperacion FOR EACH ROW EXECUTE FUNCTION fn_crm_reporte_cola_vinculo();
ALTER TABLE crm_reporte_reintento ENABLE ALWAYS TRIGGER crm_reporte_cola_vinculo;
ALTER TABLE crm_reporte_recuperacion ENABLE ALWAYS TRIGGER crm_reporte_recuperacion_vinculo;
CREATE FUNCTION fn_crm_reporte_cola_control() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.estado<>'Pendiente' OR NEW.intentos<>0 OR NEW.version<>1 THEN RAISE EXCEPTION 'La cola comienza pendiente'; END IF;
   RETURN NEW;
 END IF;
 IF NEW.id_resultado<>OLD.id_resultado OR NEW.creada_en<>OLD.creada_en OR NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'Identidad y versión de cola inválidas';
 END IF;
 IF OLD.estado='Pendiente' AND NEW.estado='EnCurso' AND NEW.intentos=OLD.intentos+1 THEN RETURN NEW; END IF;
 IF OLD.estado='Pendiente' AND NEW.estado='Cancelado' AND NEW.intentos=OLD.intentos THEN RETURN NEW; END IF;
 IF OLD.estado='EnCurso' AND NEW.estado IN('Pendiente','Completado','Agotado','Cancelado') AND NEW.intentos=OLD.intentos THEN
   IF NEW.estado='Completado' AND NOT EXISTS(SELECT 1 FROM crm_reporte_recuperacion WHERE id_resultado=OLD.id_resultado AND token=OLD.token) THEN
     RAISE EXCEPTION 'No existe resultado conservado del intento';
   END IF;
   RETURN NEW;
 END IF;
 RAISE EXCEPTION 'Transición de cola inválida';
END $$;
CREATE TRIGGER crm_reporte_cola_control BEFORE INSERT OR UPDATE ON crm_reporte_reintento FOR EACH ROW EXECUTE FUNCTION fn_crm_reporte_cola_control();
ALTER TABLE crm_reporte_reintento ENABLE ALWAYS TRIGGER crm_reporte_cola_control;
CREATE TRIGGER crm_reporte_cola_conservar BEFORE DELETE OR TRUNCATE ON crm_reporte_reintento FOR EACH STATEMENT EXECUTE FUNCTION fn_crm_secuencia_conservar();
CREATE TRIGGER crm_reporte_intento_conservar BEFORE UPDATE OR DELETE OR TRUNCATE ON crm_reporte_intento_evento FOR EACH STATEMENT EXECUTE FUNCTION fn_crm_secuencia_conservar();
CREATE TRIGGER crm_reporte_recuperacion_conservar BEFORE UPDATE OR DELETE OR TRUNCATE ON crm_reporte_recuperacion FOR EACH STATEMENT EXECUTE FUNCTION fn_crm_secuencia_conservar();
ALTER TABLE crm_reporte_reintento ENABLE ALWAYS TRIGGER crm_reporte_cola_conservar;
ALTER TABLE crm_reporte_intento_evento ENABLE ALWAYS TRIGGER crm_reporte_intento_conservar;
ALTER TABLE crm_reporte_recuperacion ENABLE ALWAYS TRIGGER crm_reporte_recuperacion_conservar;
CREATE TRIGGER crm_reporte_cola_audit AFTER INSERT OR UPDATE ON crm_reporte_reintento FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
CREATE TRIGGER crm_reporte_intento_audit AFTER INSERT ON crm_reporte_intento_evento FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
CREATE TRIGGER crm_reporte_recuperacion_audit AFTER INSERT ON crm_reporte_recuperacion FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
