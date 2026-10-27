-- V03.2: publicación deliberada, sin backfill ni adjuntos públicos.
CREATE TABLE portal_publicacion (
 id_publicacion integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 id_cliente integer NOT NULL REFERENCES cliente("IdCliente") ON DELETE RESTRICT,
 tipo varchar(12) NOT NULL CHECK(tipo IN('xml','acuse','cotizacion','entrega')),
 origen integer NOT NULL CHECK(origen>0), origen_sha256 char(64) NOT NULL CHECK(origen_sha256 ~ '^[a-f0-9]{64}$'),
 titulo varchar(200) NOT NULL, clase varchar(12) NOT NULL CHECK(clase IN('mock','sandbox','production','copia')),
 mime varchar(40) NOT NULL CHECK(mime IN('application/xml','application/pdf')),
 sha256 char(64) NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 2097152),
 request_id uuid NOT NULL UNIQUE, huella char(64) NOT NULL,
 motivo varchar(500) NOT NULL CHECK(length(btrim(motivo))>0),
 id_user integer NOT NULL REFERENCES auth_user(id_user) ON DELETE RESTRICT,
 creada_en timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX portal_publicacion_cliente ON portal_publicacion(id_cliente,id_publicacion DESC);
CREATE INDEX portal_publicacion_origen ON portal_publicacion(id_cliente,tipo,origen);
CREATE TABLE portal_publicacion_archivo (
 id_publicacion integer PRIMARY KEY REFERENCES portal_publicacion(id_publicacion) ON DELETE RESTRICT,
 contenido bytea NOT NULL CHECK(octet_length(contenido) BETWEEN 1 AND 2097152)
);
CREATE TABLE portal_publicacion_retiro (
 id_publicacion integer PRIMARY KEY REFERENCES portal_publicacion(id_publicacion) ON DELETE RESTRICT,
 request_id uuid NOT NULL UNIQUE, huella char(64) NOT NULL,
 motivo varchar(500) NOT NULL CHECK(length(btrim(motivo))>0),
 id_user integer NOT NULL REFERENCES auth_user(id_user) ON DELETE RESTRICT,
 creada_en timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION fn_portal_publicacion_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Publicaciones, archivos y retiros se conservan sin reescribir'; END $$;
CREATE TRIGGER portal_publicacion_inmutable BEFORE UPDATE OR DELETE OR TRUNCATE ON portal_publicacion FOR EACH STATEMENT EXECUTE FUNCTION fn_portal_publicacion_inmutable();
CREATE TRIGGER portal_publicacion_archivo_inmutable BEFORE UPDATE OR DELETE OR TRUNCATE ON portal_publicacion_archivo FOR EACH STATEMENT EXECUTE FUNCTION fn_portal_publicacion_inmutable();
CREATE TRIGGER portal_publicacion_retiro_inmutable BEFORE UPDATE OR DELETE OR TRUNCATE ON portal_publicacion_retiro FOR EACH STATEMENT EXECUTE FUNCTION fn_portal_publicacion_inmutable();
ALTER TABLE portal_publicacion ENABLE ALWAYS TRIGGER portal_publicacion_inmutable;
ALTER TABLE portal_publicacion_archivo ENABLE ALWAYS TRIGGER portal_publicacion_archivo_inmutable;
ALTER TABLE portal_publicacion_retiro ENABLE ALWAYS TRIGGER portal_publicacion_retiro_inmutable;
CREATE TRIGGER portal_publicacion_auditoria AFTER INSERT ON portal_publicacion FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
CREATE TRIGGER portal_publicacion_retiro_auditoria AFTER INSERT ON portal_publicacion_retiro FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
CREATE OR REPLACE FUNCTION fn_portal_proteger_secretos() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.table_name IN('portal_credencial','portal_invitacion','portal_sesion','portal_publicacion_archivo') THEN RAISE EXCEPTION 'No registrar secretos ni archivos del portal en auditoria_jsonb'; END IF;
 RETURN NEW;
END $$;
INSERT INTO app_permission(code,description) VALUES('portal.publicar','Revisar, publicar y retirar documentos para clientes del portal') ON CONFLICT DO NOTHING;
INSERT INTO app_role_permission(role,permission_code) VALUES('admin','portal.publicar') ON CONFLICT DO NOTHING;
