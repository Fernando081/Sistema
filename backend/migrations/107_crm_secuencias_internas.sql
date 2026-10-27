-- C02.1: secuencias explícitas de tareas internas; sin mensajes ni inscripciones automáticas.
CREATE TABLE crm_secuencia_modelo (
 id_modelo uuid PRIMARY KEY, nombre varchar(120) NOT NULL CHECK(length(btrim(nombre))>0),
 pasos jsonb NOT NULL CHECK(jsonb_typeof(pasos)='array' AND jsonb_array_length(pasos) BETWEEN 1 AND 8 AND octet_length(pasos::text)<=20000),
 id_creador integer NOT NULL REFERENCES auth_user(id_user) ON DELETE RESTRICT,
 huella char(64) NOT NULL, creada_en timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE crm_secuencia (
 id_secuencia uuid PRIMARY KEY, id_modelo uuid NOT NULL REFERENCES crm_secuencia_modelo ON DELETE RESTRICT,
 id_cliente integer NOT NULL REFERENCES cliente("IdCliente") ON DELETE RESTRICT,
 id_responsable integer NOT NULL REFERENCES auth_user(id_user) ON DELETE RESTRICT,
 id_creador integer NOT NULL REFERENCES auth_user(id_user) ON DELETE RESTRICT,
 motivo varchar(500) NOT NULL CHECK(length(btrim(motivo))>0), huella char(64) NOT NULL,
 estado varchar(12) NOT NULL DEFAULT 'Activa' CHECK(estado IN('Activa','Completada','Cancelada')),
 paso_actual integer NOT NULL DEFAULT 1 CHECK(paso_actual BETWEEN 1 AND 8),
 creada_en timestamptz NOT NULL DEFAULT clock_timestamp(), cerrada_en timestamptz,
 CHECK((estado='Activa')=(cerrada_en IS NULL))
);
CREATE UNIQUE INDEX crm_secuencia_activa ON crm_secuencia(id_modelo,id_cliente) WHERE estado='Activa';
CREATE INDEX crm_secuencia_responsable ON crm_secuencia(id_responsable,creada_en DESC,id_secuencia);
ALTER TABLE crm_tarea ADD COLUMN id_secuencia uuid REFERENCES crm_secuencia ON DELETE RESTRICT,
 ADD COLUMN paso_secuencia integer,
 ADD CONSTRAINT crm_tarea_secuencia_paso CHECK((id_secuencia IS NULL AND paso_secuencia IS NULL) OR (id_secuencia IS NOT NULL AND paso_secuencia BETWEEN 1 AND 8)),
 ADD CONSTRAINT crm_tarea_secuencia_unica UNIQUE(id_secuencia,paso_secuencia);
CREATE TABLE crm_secuencia_evento (
 id_evento bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 id_secuencia uuid NOT NULL REFERENCES crm_secuencia ON DELETE RESTRICT,
 id_tarea bigint NOT NULL REFERENCES crm_tarea ON DELETE RESTRICT,
 evento varchar(12) NOT NULL CHECK(evento IN('Creada','Completada','Cancelada')),
 paso integer NOT NULL CHECK(paso BETWEEN 1 AND 8),
 id_actor integer NOT NULL REFERENCES auth_user(id_user) ON DELETE RESTRICT,
 creada_en timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(id_tarea,evento)
);
CREATE INDEX crm_secuencia_eventos ON crm_secuencia_evento(id_secuencia,id_evento);
CREATE FUNCTION fn_crm_secuencia_conservar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'El modelo y el historial de secuencias se conservan'; END $$;
CREATE TRIGGER crm_secuencia_modelo_conservar BEFORE UPDATE OR DELETE OR TRUNCATE ON crm_secuencia_modelo FOR EACH STATEMENT EXECUTE FUNCTION fn_crm_secuencia_conservar();
CREATE TRIGGER crm_secuencia_evento_conservar BEFORE UPDATE OR DELETE OR TRUNCATE ON crm_secuencia_evento FOR EACH STATEMENT EXECUTE FUNCTION fn_crm_secuencia_conservar();

CREATE FUNCTION fn_crm_secuencia_tarea() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s crm_secuencia%ROWTYPE; modelo crm_secuencia_modelo%ROWTYPE; siguiente jsonb; tarea bigint; actor integer;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.id_secuencia IS NOT NULL THEN RAISE EXCEPTION 'Las tareas de secuencia conservan su historial'; END IF;
  RETURN OLD;
 END IF;
 IF NEW.id_secuencia IS DISTINCT FROM OLD.id_secuencia OR NEW.paso_secuencia IS DISTINCT FROM OLD.paso_secuencia THEN
  RAISE EXCEPTION 'No se puede cambiar el vínculo de una tarea de secuencia';
 END IF;
 IF OLD.id_secuencia IS NULL THEN RETURN NEW; END IF;
 IF (to_jsonb(NEW)-ARRAY['estado','completada_at','updated_at','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['estado','completada_at','updated_at','version']) THEN
  RAISE EXCEPTION 'La tarea conserva el contexto del modelo de secuencia';
 END IF;
 IF OLD.estado IN('Completada','Cancelada') THEN RAISE EXCEPTION 'Un paso cerrado no se reabre'; END IF;
 IF NEW.estado NOT IN('Completada','Cancelada') THEN RETURN NEW; END IF;
 SELECT * INTO STRICT s FROM crm_secuencia WHERE id_secuencia=OLD.id_secuencia FOR UPDATE;
 IF s.estado<>'Activa' OR s.paso_actual<>OLD.paso_secuencia THEN RAISE EXCEPTION 'La secuencia cambió'; END IF;
 actor:=nullif(current_setting('app.current_user_id',true),'')::integer;
 IF NOT EXISTS(SELECT 1 FROM auth_user WHERE id_user=actor AND is_active AND (role='admin' OR id_user IN(s.id_creador,s.id_responsable))) THEN
  RAISE EXCEPTION 'La tarea requiere un actor activo autorizado';
 END IF;
 INSERT INTO crm_secuencia_evento(id_secuencia,id_tarea,evento,paso,id_actor) VALUES(s.id_secuencia,OLD.id_tarea,NEW.estado,OLD.paso_secuencia,actor);
 SELECT * INTO STRICT modelo FROM crm_secuencia_modelo WHERE id_modelo=s.id_modelo;
 IF NEW.estado='Cancelada' OR s.paso_actual=jsonb_array_length(modelo.pasos) THEN
  UPDATE crm_secuencia SET estado=NEW.estado,cerrada_en=clock_timestamp() WHERE id_secuencia=s.id_secuencia;
 ELSE
  -- Serialización por tarea/ejecución: el siguiente paso se crea en la misma transacción.
  PERFORM id_user FROM auth_user WHERE id_user=s.id_responsable AND is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El responsable está inactivo; cancela la secuencia o reactiva su cuenta'; END IF;
  siguiente:=modelo.pasos->s.paso_actual;
  INSERT INTO crm_tarea(titulo,descripcion,prioridad,fecha_vencimiento,id_responsable,id_cliente,id_creador,id_secuencia,paso_secuencia)
   VALUES(siguiente->>'titulo',siguiente->>'descripcion',siguiente->>'prioridad',clock_timestamp()+make_interval(hours=>(siguiente->>'horas')::integer),s.id_responsable,s.id_cliente,s.id_creador,s.id_secuencia,s.paso_actual+1) RETURNING id_tarea INTO tarea;
  UPDATE crm_secuencia SET paso_actual=paso_actual+1 WHERE id_secuencia=s.id_secuencia;
  INSERT INTO crm_secuencia_evento(id_secuencia,id_tarea,evento,paso,id_actor) VALUES(s.id_secuencia,tarea,'Creada',s.paso_actual+1,actor);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crm_secuencia_tarea BEFORE UPDATE OR DELETE ON crm_tarea FOR EACH ROW EXECUTE FUNCTION fn_crm_secuencia_tarea();
CREATE TRIGGER crm_secuencia_modelo_audit AFTER INSERT ON crm_secuencia_modelo FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
CREATE TRIGGER crm_secuencia_audit AFTER INSERT OR UPDATE OR DELETE ON crm_secuencia FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
CREATE TRIGGER crm_secuencia_evento_audit AFTER INSERT ON crm_secuencia_evento FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
INSERT INTO app_permission(code,description) VALUES('crm.secuencias.gestionar','Crear modelos y ejecutar secuencias internas de tareas CRM');
INSERT INTO app_role_permission(role,permission_code) VALUES('admin','crm.secuencias.gestionar');
ALTER TABLE crm_secuencia_modelo ENABLE ALWAYS TRIGGER crm_secuencia_modelo_conservar;
ALTER TABLE crm_secuencia_evento ENABLE ALWAYS TRIGGER crm_secuencia_evento_conservar;
