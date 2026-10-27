-- V02: opt-in por nueva entrega; no inventa evidencias para entregas históricas.
CREATE TABLE pedido_entrega_evidencia (
 id_entrega bigint PRIMARY KEY REFERENCES entrega_pedido(id_entrega) ON DELETE RESTRICT,
 request_id uuid NOT NULL UNIQUE, huella char(64) NOT NULL,
 autor_nombre text NOT NULL, snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 sha256 char(64) NOT NULL, creada_en timestamptz NOT NULL DEFAULT now()
);
-- Bytes fuera de auditoria_jsonb: sólo metadata y huellas se auditan.
CREATE TABLE pedido_entrega_archivo (
 id_entrega bigint NOT NULL REFERENCES pedido_entrega_evidencia(id_entrega) ON DELETE RESTRICT,
 tipo varchar(5) NOT NULL CHECK(tipo IN ('firma','foto')),
 mime varchar(20) NOT NULL CHECK(mime IN ('image/png','image/jpeg','image/webp')),
 sha256 char(64) NOT NULL, contenido bytea NOT NULL CHECK(octet_length(contenido) BETWEEN 1 AND 5242880),
 PRIMARY KEY(id_entrega,tipo)
);
CREATE FUNCTION fn_pedido_entrega_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'El comprobante de entrega se conserva sin reescribir'; END $$;
CREATE TRIGGER pedido_entrega_evidencia_inmutable BEFORE UPDATE OR DELETE OR TRUNCATE ON pedido_entrega_evidencia
 FOR EACH STATEMENT EXECUTE FUNCTION fn_pedido_entrega_inmutable();
CREATE TRIGGER pedido_entrega_archivo_inmutable BEFORE UPDATE OR DELETE OR TRUNCATE ON pedido_entrega_archivo
 FOR EACH STATEMENT EXECUTE FUNCTION fn_pedido_entrega_inmutable();
ALTER TABLE pedido_entrega_evidencia ENABLE ALWAYS TRIGGER pedido_entrega_evidencia_inmutable;
ALTER TABLE pedido_entrega_archivo ENABLE ALWAYS TRIGGER pedido_entrega_archivo_inmutable;
CREATE FUNCTION fn_proteger_entrega_evidenciada() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM pedido_entrega_evidencia WHERE id_entrega=OLD.id_entrega) THEN
  RAISE EXCEPTION 'La entrega evidenciada se conserva sin reescribir';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER entrega_evidenciada_protegida BEFORE UPDATE OR DELETE ON entrega_pedido
 FOR EACH ROW EXECUTE FUNCTION fn_proteger_entrega_evidenciada();
ALTER TABLE entrega_pedido ENABLE ALWAYS TRIGGER entrega_evidenciada_protegida;
CREATE TRIGGER trg_audit_entrega_evidencia AFTER INSERT ON pedido_entrega_evidencia
 FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
INSERT INTO app_permission(code,description) VALUES
 ('pedidos.entregas','Registrar entregas y consultar evidencia privada y comprobantes') ON CONFLICT DO NOTHING;
INSERT INTO app_role_permission(role,permission_code) VALUES('admin','pedidos.entregas') ON CONFLICT DO NOTHING;
