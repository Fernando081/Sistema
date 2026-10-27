-- V03.1: identidad externa independiente. No inscribe clientes existentes.
CREATE TABLE portal_acceso (
 id_acceso integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 id_cliente integer NOT NULL REFERENCES cliente("IdCliente") ON DELETE RESTRICT,
 alias varchar(80) NOT NULL UNIQUE CHECK(alias=lower(alias) AND alias ~ '^[a-z0-9][a-z0-9._-]{2,79}$'),
 nombre varchar(150) NOT NULL CHECK(length(btrim(nombre))>0),
 estado varchar(12) NOT NULL DEFAULT 'Pendiente' CHECK(estado IN ('Pendiente','Activo','Suspendido')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), creada_en timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX portal_acceso_cliente ON portal_acceso(id_cliente,id_acceso DESC);
CREATE INDEX portal_cotizacion_cliente ON cotizacion(id_cliente,id_cotizacion);
CREATE INDEX portal_garantia_factura ON garantia(id_factura,id_garantia);
CREATE FUNCTION fn_portal_cliente_fijo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id_cliente<>OLD.id_cliente OR NEW.alias<>OLD.alias THEN RAISE EXCEPTION 'El cliente y alias de un acceso no se reasignan'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER portal_cliente_fijo BEFORE UPDATE ON portal_acceso FOR EACH ROW EXECUTE FUNCTION fn_portal_cliente_fijo();
CREATE TABLE portal_credencial (
 id_acceso integer PRIMARY KEY REFERENCES portal_acceso(id_acceso) ON DELETE RESTRICT,
 password_hash text, fallos integer NOT NULL DEFAULT 0 CHECK(fallos>=0), bloqueado_hasta timestamptz
);
CREATE TABLE portal_invitacion (
 id_invitacion integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 id_acceso integer NOT NULL REFERENCES portal_acceso(id_acceso) ON DELETE RESTRICT,
 request_id uuid NOT NULL UNIQUE, huella char(64) NOT NULL, token_hash char(64) NOT NULL UNIQUE,
 version integer NOT NULL, creada_en timestamptz NOT NULL DEFAULT clock_timestamp(), vence_en timestamptz NOT NULL,
 usada_en timestamptz, revocada boolean NOT NULL DEFAULT false, CHECK(vence_en>creada_en)
);
CREATE TABLE portal_sesion (
 token_hash char(64) PRIMARY KEY, id_acceso integer NOT NULL REFERENCES portal_acceso(id_acceso) ON DELETE RESTRICT,
 version integer NOT NULL, creada_en timestamptz NOT NULL DEFAULT clock_timestamp(), vence_en timestamptz NOT NULL,
 revocada_en timestamptz, CHECK(vence_en>creada_en)
);
CREATE INDEX portal_sesion_cuenta ON portal_sesion(id_acceso,creada_en DESC) WHERE revocada_en IS NULL;
CREATE TABLE portal_evento (
 id_evento bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 id_acceso integer NOT NULL REFERENCES portal_acceso(id_acceso) ON DELETE RESTRICT,
 tipo varchar(30) NOT NULL, motivo varchar(500) NOT NULL DEFAULT '',
 request_id uuid, huella char(64), creada_en timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(id_acceso,request_id), CHECK((request_id IS NULL)=(huella IS NULL))
);
CREATE FUNCTION fn_portal_evento_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Los eventos del portal se conservan sin reescribir'; END $$;
CREATE TRIGGER portal_evento_inmutable BEFORE UPDATE OR DELETE OR TRUNCATE ON portal_evento FOR EACH STATEMENT EXECUTE FUNCTION fn_portal_evento_inmutable();
ALTER TABLE portal_evento ENABLE ALWAYS TRIGGER portal_evento_inmutable;
CREATE TRIGGER portal_acceso_auditoria AFTER INSERT OR UPDATE OR DELETE ON portal_acceso FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
CREATE TRIGGER portal_evento_auditoria AFTER INSERT ON portal_evento FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
-- Defensa adicional: futuras altas accidentales de un trigger genérico no deben copiar secretos.
CREATE FUNCTION fn_portal_proteger_secretos() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.table_name IN ('portal_credencial','portal_invitacion','portal_sesion') THEN RAISE EXCEPTION 'No registrar secretos del portal en auditoria_jsonb'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER portal_proteger_secretos BEFORE INSERT ON auditoria_jsonb FOR EACH ROW EXECUTE FUNCTION fn_portal_proteger_secretos();
ALTER TABLE auditoria_jsonb ENABLE ALWAYS TRIGGER portal_proteger_secretos;
INSERT INTO app_permission(code,description) VALUES('portal.gestionar','Habilitar, restablecer y suspender accesos privados de clientes') ON CONFLICT DO NOTHING;
INSERT INTO app_role_permission(role,permission_code) VALUES('admin','portal.gestionar') ON CONFLICT DO NOTHING;
