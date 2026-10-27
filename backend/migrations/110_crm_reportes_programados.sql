-- Resúmenes internos; no envíos ni capturas históricas inventadas.
INSERT INTO app_permission(code,description) VALUES('crm.reportes.programar','Programar y consultar reportes comerciales internos propios');
INSERT INTO app_role_permission(role,permission_code) VALUES('admin','crm.reportes.programar');
INSERT INTO operational_job(name,interval_seconds,grace_seconds) VALUES('crm_reports',600,300);
CREATE TABLE crm_reporte_programa (
 id_programa uuid PRIMARY KEY, nombre varchar(120) NOT NULL CHECK(length(trim(nombre))>0),
 id_propietario integer NOT NULL REFERENCES auth_user(id_user) ON DELETE RESTRICT,
 frecuencia varchar(10) NOT NULL CHECK(frecuencia IN('Diaria','Semanal')),
 hora smallint NOT NULL CHECK(hora BETWEEN 0 AND 23), minuto smallint NOT NULL CHECK(minuto IN(0,10,20,30,40,50)),
 dia smallint CHECK(dia BETWEEN 1 AND 7),
 tipo varchar(15) NOT NULL CHECK(tipo IN('todos','tarea','oportunidad','cotizacion','web')),
 plazo varchar(15) NOT NULL CHECK(plazo IN('todos','vencidas','hoy','proximas','sin-fecha')),
 zona varchar(40) NOT NULL DEFAULT 'America/Mexico_City' CHECK(zona='America/Mexico_City'),
 activa boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 huella char(64) NOT NULL CHECK(huella ~ '^[a-f0-9]{64}$'),
 creada_en timestamptz NOT NULL DEFAULT clock_timestamp(), vigente_desde timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((frecuencia='Diaria' AND dia IS NULL) OR (frecuencia='Semanal' AND dia IS NOT NULL))
);
CREATE INDEX crm_reporte_programa_propietario ON crm_reporte_programa(id_propietario,creada_en DESC,id_programa);
CREATE INDEX crm_reporte_programa_activo ON crm_reporte_programa(id_programa) WHERE activa;
CREATE TABLE crm_reporte_resultado (
 id_resultado uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 id_programa uuid NOT NULL REFERENCES crm_reporte_programa(id_programa) ON DELETE RESTRICT,
 programada_en timestamptz NOT NULL, generada_en timestamptz NOT NULL DEFAULT clock_timestamp(),
 estado varchar(10) NOT NULL CHECK(estado IN('Generado','Error')),
 snapshot jsonb, codigo varchar(30), UNIQUE(id_programa,programada_en),
 CHECK((estado='Generado' AND snapshot IS NOT NULL AND codigo IS NULL) OR
       (estado='Error' AND snapshot IS NULL AND codigo='GENERACION_FALLIDA')),
 CHECK(snapshot IS NULL OR (jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=8192 AND snapshot->>'version'='1'))
);
CREATE INDEX crm_reporte_resultado_historia ON crm_reporte_resultado(id_programa,programada_en DESC,id_resultado);
CREATE FUNCTION fn_crm_reporte_programa_control() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN NEW.creada_en=clock_timestamp(); NEW.vigente_desde=NEW.creada_en; RETURN NEW; END IF;
 IF (to_jsonb(NEW)-ARRAY['activa','version','vigente_desde']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['activa','version','vigente_desde']) OR NEW.version<>OLD.version+1 OR NEW.activa=OLD.activa THEN
   RAISE EXCEPTION 'La configuración se conserva; sólo se permite suspender o reanudar con versión';
 END IF;
 NEW.vigente_desde=CASE WHEN NEW.activa THEN clock_timestamp() ELSE OLD.vigente_desde END;
 RETURN NEW;
END $$;
CREATE TRIGGER crm_reporte_programa_control BEFORE INSERT OR UPDATE ON crm_reporte_programa FOR EACH ROW EXECUTE FUNCTION fn_crm_reporte_programa_control();
ALTER TABLE crm_reporte_programa ENABLE ALWAYS TRIGGER crm_reporte_programa_control;
CREATE TRIGGER crm_reporte_programa_conservar BEFORE DELETE OR TRUNCATE ON crm_reporte_programa FOR EACH STATEMENT EXECUTE FUNCTION fn_crm_secuencia_conservar();
CREATE TRIGGER crm_reporte_resultado_conservar BEFORE UPDATE OR DELETE OR TRUNCATE ON crm_reporte_resultado FOR EACH STATEMENT EXECUTE FUNCTION fn_crm_secuencia_conservar();
ALTER TABLE crm_reporte_programa ENABLE ALWAYS TRIGGER crm_reporte_programa_conservar;
ALTER TABLE crm_reporte_resultado ENABLE ALWAYS TRIGGER crm_reporte_resultado_conservar;
CREATE TRIGGER crm_reporte_programa_audit AFTER INSERT OR UPDATE ON crm_reporte_programa FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
CREATE TRIGGER crm_reporte_resultado_audit AFTER INSERT ON crm_reporte_resultado FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
