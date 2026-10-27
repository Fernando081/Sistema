-- C01.1 local: autorizaciones declaradas y preparación, sin envíos ni backfill.
CREATE TABLE crm_consentimiento_comercial (
 id_consentimiento integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 id_cliente integer NOT NULL REFERENCES cliente("IdCliente") ON DELETE RESTRICT,
 -- Referencia histórica: borrar un contacto no borra ni reactiva una baja.
 id_contacto integer NOT NULL CHECK(id_contacto>0),
 canal varchar(10) NOT NULL CHECK(canal IN('Correo','WhatsApp','Llamada')),
 finalidad varchar(20) NOT NULL DEFAULT 'Promociones' CHECK(finalidad='Promociones'),
 destino_hash char(64) NOT NULL CHECK(destino_hash ~ '^[a-f0-9]{64}$'),
 estado varchar(10) NOT NULL CHECK(estado IN('Autorizado','Baja')),
 version integer NOT NULL CHECK(version>0),
 ocurrida_en timestamptz NOT NULL, vence_en timestamptz,
 fuente varchar(12) NOT NULL CHECK(fuente IN('Presencial','Llamada','Correo','WhatsApp','Documento')),
 referencia varchar(500) NOT NULL CHECK(length(btrim(referencia))>0),
 motivo varchar(500) NOT NULL CHECK(length(btrim(motivo))>0),
 id_user integer NOT NULL REFERENCES auth_user(id_user) ON DELETE RESTRICT,
 request_id uuid NOT NULL UNIQUE, huella char(64) NOT NULL,
 creada_en timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(id_contacto,canal,version),CHECK(vence_en IS NULL OR (estado='Autorizado' AND vence_en>ocurrida_en))
);
CREATE INDEX crm_consentimiento_cliente ON crm_consentimiento_comercial(id_cliente,id_contacto,canal,version DESC);
CREATE INDEX crm_consentimiento_destino ON crm_consentimiento_comercial(canal,destino_hash,id_contacto,version DESC);
CREATE TABLE crm_campana_preparacion (
 id_preparacion integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 id_campana integer NOT NULL REFERENCES crm_campana(id_campana) ON DELETE RESTRICT,
 request_id uuid NOT NULL UNIQUE, huella char(64) NOT NULL,
 evaluacion_sha256 char(64) NOT NULL CHECK(evaluacion_sha256 ~ '^[a-f0-9]{64}$'),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=524288),
 sha256 char(64) NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 motivo varchar(500) NOT NULL CHECK(length(btrim(motivo))>0),
 id_user integer NOT NULL REFERENCES auth_user(id_user) ON DELETE RESTRICT,
 creada_en timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX crm_campana_preparacion_historia ON crm_campana_preparacion(id_campana,id_preparacion DESC);
CREATE FUNCTION fn_crm_campana_conservar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Autorizaciones, bajas y preparaciones se conservan sin reescribir'; END $$;
CREATE TRIGGER crm_consentimiento_conservar BEFORE UPDATE OR DELETE OR TRUNCATE ON crm_consentimiento_comercial FOR EACH STATEMENT EXECUTE FUNCTION fn_crm_campana_conservar();
CREATE TRIGGER crm_preparacion_conservar BEFORE UPDATE OR DELETE OR TRUNCATE ON crm_campana_preparacion FOR EACH STATEMENT EXECUTE FUNCTION fn_crm_campana_conservar();
ALTER TABLE crm_consentimiento_comercial ENABLE ALWAYS TRIGGER crm_consentimiento_conservar;
ALTER TABLE crm_campana_preparacion ENABLE ALWAYS TRIGGER crm_preparacion_conservar;
CREATE TRIGGER crm_consentimiento_auditoria AFTER INSERT ON crm_consentimiento_comercial FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
CREATE TRIGGER crm_preparacion_auditoria AFTER INSERT ON crm_campana_preparacion FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
INSERT INTO app_permission(code,description) VALUES('crm.campanas.gestionar','Registrar consentimiento y bajas comerciales; revisar y preparar destinatarios sin enviar') ON CONFLICT DO NOTHING;
INSERT INTO app_role_permission(role,permission_code) VALUES('admin','crm.campanas.gestionar') ON CONFLICT DO NOTHING;
