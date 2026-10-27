-- C02.2b: eventos nuevos y reglas de inicio supervisadas; sin backfill ni cron.
CREATE TABLE crm_etapa_evento (
 id_evento bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 id_oportunidad integer NOT NULL REFERENCES crm_oportunidad ON DELETE RESTRICT,
 version_origen integer NOT NULL,
 tipo varchar(10) NOT NULL CHECK(tipo IN('Alta','Etapa','Asignacion')),
 etapa varchar(20) NOT NULL CHECK(etapa IN('Prospecto','Contactado','Cotizando','Negociacion','Ganada','Perdida')),
 id_cliente integer REFERENCES cliente("IdCliente") ON DELETE RESTRICT,
 id_responsable integer REFERENCES auth_user ON DELETE RESTRICT,
 creada_en timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX crm_etapa_evento_regla ON crm_etapa_evento(etapa,id_evento DESC);
CREATE INDEX crm_etapa_evento_origen ON crm_etapa_evento(id_oportunidad,id_evento DESC);
CREATE FUNCTION fn_crm_etapa_evento() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.etapa IS DISTINCT FROM OLD.etapa OR NEW.id_cliente IS DISTINCT FROM OLD.id_cliente OR NEW.id_responsable IS DISTINCT FROM OLD.id_responsable THEN
  INSERT INTO crm_etapa_evento(id_oportunidad,version_origen,tipo,etapa,id_cliente,id_responsable) VALUES(NEW.id_oportunidad,NEW.version,CASE WHEN TG_OP='INSERT' THEN 'Alta' WHEN NEW.etapa IS DISTINCT FROM OLD.etapa THEN 'Etapa' ELSE 'Asignacion' END,NEW.etapa,NEW.id_cliente,NEW.id_responsable);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crm_etapa_evento AFTER INSERT OR UPDATE OF etapa,id_cliente,id_responsable ON crm_oportunidad FOR EACH ROW EXECUTE FUNCTION fn_crm_etapa_evento();
CREATE TABLE crm_secuencia_regla (
 id_regla uuid PRIMARY KEY, nombre varchar(120) NOT NULL CHECK(length(btrim(nombre))>0),
 id_modelo uuid NOT NULL REFERENCES crm_secuencia_modelo ON DELETE RESTRICT,
 etapa varchar(20) NOT NULL CHECK(etapa IN('Prospecto','Contactado','Cotizando','Negociacion','Ganada','Perdida')),
 evento_desde bigint NOT NULL CHECK(evento_desde>=0),
 id_creador integer NOT NULL REFERENCES auth_user ON DELETE RESTRICT,
 huella char(64) NOT NULL, creada_en timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE crm_secuencia_aplicacion (
 request_id uuid PRIMARY KEY, id_regla uuid NOT NULL REFERENCES crm_secuencia_regla ON DELETE RESTRICT,
 id_evento bigint NOT NULL REFERENCES crm_etapa_evento ON DELETE RESTRICT,
 id_modelo uuid NOT NULL REFERENCES crm_secuencia_modelo ON DELETE RESTRICT,
 id_secuencia uuid NOT NULL UNIQUE REFERENCES crm_secuencia ON DELETE RESTRICT,
 id_actor integer NOT NULL REFERENCES auth_user ON DELETE RESTRICT,
 motivo varchar(500) NOT NULL CHECK(length(btrim(motivo))>0),
 evaluacion_sha256 char(64) NOT NULL, huella char(64) NOT NULL,
 creada_en timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(id_evento,id_modelo)
);
CREATE INDEX crm_secuencia_aplicacion_historia ON crm_secuencia_aplicacion(id_regla,creada_en DESC,request_id);
CREATE FUNCTION fn_crm_regla_vinculo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM crm_secuencia_regla r JOIN crm_etapa_evento e ON e.id_evento=NEW.id_evento JOIN crm_secuencia s ON s.id_secuencia=NEW.id_secuencia
  WHERE r.id_regla=NEW.id_regla AND r.id_modelo=NEW.id_modelo AND s.id_modelo=r.id_modelo AND s.id_cliente=e.id_cliente AND s.id_responsable=e.id_responsable
   AND r.etapa=e.etapa AND e.id_evento>r.evento_desde AND e.creada_en>=r.creada_en) THEN RAISE EXCEPTION 'La aplicación no corresponde a la regla y al evento'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crm_regla_vinculo BEFORE INSERT ON crm_secuencia_aplicacion FOR EACH ROW EXECUTE FUNCTION fn_crm_regla_vinculo();
CREATE TRIGGER crm_etapa_conservar BEFORE UPDATE OR DELETE OR TRUNCATE ON crm_etapa_evento FOR EACH STATEMENT EXECUTE FUNCTION fn_crm_secuencia_conservar();
CREATE TRIGGER crm_regla_conservar BEFORE UPDATE OR DELETE OR TRUNCATE ON crm_secuencia_regla FOR EACH STATEMENT EXECUTE FUNCTION fn_crm_secuencia_conservar();
CREATE TRIGGER crm_aplicacion_conservar BEFORE UPDATE OR DELETE OR TRUNCATE ON crm_secuencia_aplicacion FOR EACH STATEMENT EXECUTE FUNCTION fn_crm_secuencia_conservar();
ALTER TABLE crm_etapa_evento ENABLE ALWAYS TRIGGER crm_etapa_conservar;
ALTER TABLE crm_secuencia_regla ENABLE ALWAYS TRIGGER crm_regla_conservar;
ALTER TABLE crm_secuencia_aplicacion ENABLE ALWAYS TRIGGER crm_aplicacion_conservar;
CREATE TRIGGER crm_regla_audit AFTER INSERT ON crm_secuencia_regla FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
CREATE TRIGGER crm_aplicacion_audit AFTER INSERT ON crm_secuencia_aplicacion FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
