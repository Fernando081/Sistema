-- C02.2a: controles internos, sin crear tareas ni inscripciones por eventos.
ALTER TABLE crm_secuencia ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0),
 ADD COLUMN pausada_en timestamptz, ADD COLUMN plazo_restante interval;
ALTER TABLE crm_secuencia DROP CONSTRAINT crm_secuencia_estado_check, DROP CONSTRAINT crm_secuencia_check;
ALTER TABLE crm_secuencia ADD CONSTRAINT crm_secuencia_estado_check CHECK(estado IN('Activa','Pausada','Completada','Cancelada')),
 ADD CONSTRAINT crm_secuencia_cierre CHECK((estado IN('Activa','Pausada'))=(cerrada_en IS NULL)),
 ADD CONSTRAINT crm_secuencia_pausa CHECK((estado='Pausada' AND pausada_en IS NOT NULL AND plazo_restante IS NOT NULL) OR (estado<>'Pausada' AND pausada_en IS NULL AND plazo_restante IS NULL));
DROP INDEX crm_secuencia_activa;
CREATE UNIQUE INDEX crm_secuencia_activa ON crm_secuencia(id_modelo,id_cliente) WHERE estado IN('Activa','Pausada');
CREATE TABLE crm_secuencia_control (
 request_id uuid PRIMARY KEY, id_secuencia uuid NOT NULL REFERENCES crm_secuencia ON DELETE RESTRICT,
 id_tarea bigint NOT NULL REFERENCES crm_tarea ON DELETE RESTRICT,
 accion varchar(12) NOT NULL CHECK(accion IN('Pausar','Reanudar','Reasignar')),
 motivo varchar(500) NOT NULL CHECK(length(btrim(motivo))>0),
 id_actor integer NOT NULL REFERENCES auth_user ON DELETE RESTRICT,
 id_anterior integer NOT NULL REFERENCES auth_user ON DELETE RESTRICT,
 id_nuevo integer NOT NULL REFERENCES auth_user ON DELETE RESTRICT,
 vence_antes timestamptz NOT NULL, vence_despues timestamptz NOT NULL,
 version_anterior integer NOT NULL CHECK(version_anterior>0), version_resultante integer NOT NULL CHECK(version_resultante=version_anterior+1),
 huella char(64) NOT NULL, creada_en timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(id_secuencia,version_resultante)
);
CREATE INDEX crm_secuencia_control_historial ON crm_secuencia_control(id_secuencia,version_resultante DESC);
CREATE TRIGGER crm_secuencia_control_conservar BEFORE UPDATE OR DELETE OR TRUNCATE ON crm_secuencia_control FOR EACH STATEMENT EXECUTE FUNCTION fn_crm_secuencia_conservar();
ALTER TABLE crm_secuencia_control ENABLE ALWAYS TRIGGER crm_secuencia_control_conservar;
CREATE TRIGGER crm_secuencia_control_audit AFTER INSERT ON crm_secuencia_control FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE OR REPLACE FUNCTION fn_crm_secuencia_tarea() RETURNS trigger LANGUAGE plpgsql AS $$
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
 SELECT * INTO STRICT s FROM crm_secuencia WHERE id_secuencia=OLD.id_secuencia FOR UPDATE;
 IF s.estado NOT IN('Activa','Pausada') OR s.paso_actual<>OLD.paso_secuencia OR OLD.estado IN('Completada','Cancelada') THEN
  RAISE EXCEPTION 'El paso ya cambió o está cerrado; actualiza la secuencia';
 END IF;
 actor:=nullif(current_setting('app.current_user_id',true),'')::integer;
 IF NOT EXISTS(SELECT 1 FROM auth_user WHERE id_user=actor AND is_active AND (role='admin' OR id_user IN(s.id_creador,s.id_responsable))) THEN
  RAISE EXCEPTION 'La tarea requiere un actor activo autorizado';
 END IF;
 IF current_setting('app.crm_sequence_control',true)=s.id_secuencia::text THEN
  IF NOT EXISTS(SELECT 1 FROM auth_user WHERE id_user=actor AND fn_effective_permission(id_user,role,'crm.secuencias.gestionar')) THEN RAISE EXCEPTION 'El permiso de secuencias cambió'; END IF;
  IF (to_jsonb(NEW)-ARRAY['id_responsable','fecha_vencimiento','updated_at','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['id_responsable','fecha_vencimiento','updated_at','version']) OR NEW.id_responsable<>s.id_responsable THEN
   RAISE EXCEPTION 'El control conserva el contenido y estado de la tarea';
  END IF;
  RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-ARRAY['estado','completada_at','updated_at','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['estado','completada_at','updated_at','version']) THEN
  RAISE EXCEPTION 'La tarea conserva el contexto del modelo de secuencia';
 END IF;
 IF s.estado='Pausada' AND NEW.estado<>'Cancelada' THEN RAISE EXCEPTION 'Reanuda la secuencia antes de avanzar el paso'; END IF;
 IF NEW.estado NOT IN('Completada','Cancelada') THEN
  UPDATE crm_secuencia SET version=version+1 WHERE id_secuencia=s.id_secuencia; RETURN NEW;
 END IF;
 INSERT INTO crm_secuencia_evento(id_secuencia,id_tarea,evento,paso,id_actor) VALUES(s.id_secuencia,OLD.id_tarea,NEW.estado,OLD.paso_secuencia,actor);
 SELECT * INTO STRICT modelo FROM crm_secuencia_modelo WHERE id_modelo=s.id_modelo;
 IF NEW.estado='Cancelada' OR s.paso_actual=jsonb_array_length(modelo.pasos) THEN
  UPDATE crm_secuencia SET estado=NEW.estado,cerrada_en=clock_timestamp(),pausada_en=NULL,plazo_restante=NULL,version=version+1 WHERE id_secuencia=s.id_secuencia;
 ELSE
  PERFORM id_user FROM auth_user WHERE id_user=s.id_responsable AND is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El responsable está inactivo; reasigna o cancela la secuencia'; END IF;
  siguiente:=modelo.pasos->s.paso_actual;
  INSERT INTO crm_tarea(titulo,descripcion,prioridad,fecha_vencimiento,id_responsable,id_cliente,id_creador,id_secuencia,paso_secuencia)
   VALUES(siguiente->>'titulo',siguiente->>'descripcion',siguiente->>'prioridad',clock_timestamp()+make_interval(hours=>(siguiente->>'horas')::integer),s.id_responsable,s.id_cliente,s.id_creador,s.id_secuencia,s.paso_actual+1) RETURNING id_tarea INTO tarea;
  UPDATE crm_secuencia SET paso_actual=paso_actual+1,version=version+1 WHERE id_secuencia=s.id_secuencia;
  INSERT INTO crm_secuencia_evento(id_secuencia,id_tarea,evento,paso,id_actor) VALUES(s.id_secuencia,tarea,'Creada',s.paso_actual+1,actor);
 END IF;
 RETURN NEW;
END $$;
