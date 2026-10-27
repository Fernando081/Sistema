-- O01.2a: solicitudes conservadas y consumidor local; ningún estado significa enviado.
INSERT INTO app_permission(code,description) VALUES('ventas.correo.gestionar','Preparar y simular localmente la salida privada de documentos de venta');
INSERT INTO app_role_permission(role,permission_code) VALUES('admin','ventas.correo.gestionar');
CREATE TABLE documento_salida (
 id uuid PRIMARY KEY, id_factura integer NOT NULL REFERENCES factura(id_factura) ON DELETE RESTRICT,
 id_cliente integer NOT NULL REFERENCES cliente("IdCliente") ON DELETE RESTRICT,
 id_actor integer NOT NULL REFERENCES auth_user(id_user) ON DELETE RESTRICT,
 modo varchar(10) NOT NULL DEFAULT 'Local' CHECK(modo='Local'),
 origen_sha256 char(64) NOT NULL CHECK(origen_sha256 ~ '^[a-f0-9]{64}$'),
 contenido_sha256 char(64) NOT NULL CHECK(contenido_sha256 ~ '^[a-f0-9]{64}$'),
 pdf_sha256 char(64) NOT NULL CHECK(pdf_sha256 ~ '^[a-f0-9]{64}$'),
 huella char(64) NOT NULL CHECK(huella ~ '^[a-f0-9]{64}$'),
 ambiente varchar(12) NOT NULL CHECK(ambiente IN('mock','sandbox','production')),
 bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 2097152), creada_en timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX documento_salida_factura ON documento_salida(id_factura,creada_en DESC,id);
CREATE TABLE documento_salida_archivo (
 id uuid PRIMARY KEY REFERENCES documento_salida(id) ON DELETE RESTRICT,
 destinatario varchar(254) NOT NULL, asunto varchar(300) NOT NULL, cuerpo varchar(4000) NOT NULL,
 contenido bytea NOT NULL CHECK(octet_length(contenido) BETWEEN 1 AND 2097152 AND substring(contenido FROM 1 FOR 4)=decode('25504446','hex'))
);
CREATE TABLE documento_salida_cierre (
 id uuid PRIMARY KEY REFERENCES documento_salida(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL UNIQUE, huella char(64) NOT NULL CHECK(huella ~ '^[a-f0-9]{64}$'),
 accion varchar(10) NOT NULL CHECK(accion IN('Simulado','Cancelado','Obsoleto')),
 motivo varchar(300), id_actor integer NOT NULL REFERENCES auth_user(id_user) ON DELETE RESTRICT,
 creada_en timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((accion='Cancelado' AND motivo IS NOT NULL AND length(trim(motivo))>0) OR (accion<>'Cancelado' AND motivo IS NULL))
);
CREATE FUNCTION fn_documento_salida_archivo_privado() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'No registrar destinatarios, cuerpo o archivos de salida en auditoría'; END $$;
CREATE FUNCTION fn_documento_salida_vinculo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='documento_salida' THEN
   IF NOT EXISTS(SELECT 1 FROM factura WHERE id_factura=NEW.id_factura AND id_cliente=NEW.id_cliente AND estatus<>'Cancelada' AND id_factura_global IS NULL) THEN
     RAISE EXCEPTION 'Origen de salida no disponible';
   END IF;
 ELSE
   IF NOT EXISTS(SELECT 1 FROM documento_salida WHERE id=NEW.id AND bytes=octet_length(NEW.contenido)) THEN RAISE EXCEPTION 'Archivo y metadatos de salida no coinciden'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER documento_salida_vinculo BEFORE INSERT ON documento_salida FOR EACH ROW EXECUTE FUNCTION fn_documento_salida_vinculo();
CREATE TRIGGER documento_salida_archivo_vinculo BEFORE INSERT ON documento_salida_archivo FOR EACH ROW EXECUTE FUNCTION fn_documento_salida_vinculo();
ALTER TABLE documento_salida ENABLE ALWAYS TRIGGER documento_salida_vinculo;
ALTER TABLE documento_salida_archivo ENABLE ALWAYS TRIGGER documento_salida_archivo_vinculo;
CREATE TRIGGER documento_salida_archivo_privado BEFORE INSERT OR UPDATE ON auditoria_jsonb FOR EACH ROW WHEN(NEW.table_name='documento_salida_archivo') EXECUTE FUNCTION fn_documento_salida_archivo_privado();
ALTER TABLE auditoria_jsonb ENABLE ALWAYS TRIGGER documento_salida_archivo_privado;
CREATE TRIGGER documento_salida_conservar BEFORE UPDATE OR DELETE OR TRUNCATE ON documento_salida FOR EACH STATEMENT EXECUTE FUNCTION fn_crm_secuencia_conservar();
CREATE TRIGGER documento_salida_archivo_conservar BEFORE UPDATE OR DELETE OR TRUNCATE ON documento_salida_archivo FOR EACH STATEMENT EXECUTE FUNCTION fn_crm_secuencia_conservar();
CREATE TRIGGER documento_salida_cierre_conservar BEFORE UPDATE OR DELETE OR TRUNCATE ON documento_salida_cierre FOR EACH STATEMENT EXECUTE FUNCTION fn_crm_secuencia_conservar();
ALTER TABLE documento_salida ENABLE ALWAYS TRIGGER documento_salida_conservar;
ALTER TABLE documento_salida_archivo ENABLE ALWAYS TRIGGER documento_salida_archivo_conservar;
ALTER TABLE documento_salida_cierre ENABLE ALWAYS TRIGGER documento_salida_cierre_conservar;
CREATE TRIGGER documento_salida_auditoria AFTER INSERT ON documento_salida FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
CREATE TRIGGER documento_salida_cierre_auditoria AFTER INSERT ON documento_salida_cierre FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
