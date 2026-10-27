-- Conserva autorizaciones históricas y comportamiento inicial de un único administrador.
CREATE TABLE comercial_regla_aprobacion (
  operacion varchar(15) NOT NULL CHECK(operacion IN ('Venta','Pedido','Cotizacion')),
  tipo varchar(25) NOT NULL CHECK(tipo IN ('Descuento','Margen bajo','Exceso credito')),
  monto_maximo numeric(18,2) NULL CHECK(monto_maximo>=0),
  requiere_distinto boolean NOT NULL DEFAULT false,
  vigencia_maxima_horas integer NOT NULL DEFAULT 24 CHECK(vigencia_maxima_horas BETWEEN 1 AND 720),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  motivo varchar(1000) NOT NULL,
  PRIMARY KEY(operacion,tipo)
);
INSERT INTO comercial_regla_aprobacion(operacion,tipo,motivo)
  SELECT o,t,'Compatibilidad inicial: sin límite nuevo ni separación obligatoria.'
  FROM unnest(ARRAY['Venta','Pedido','Cotizacion']) o CROSS JOIN unnest(ARRAY['Descuento','Margen bajo','Exceso credito']) t;

CREATE TABLE comercial_limite_aprobador (
  id_usuario integer NOT NULL REFERENCES auth_user(id_user) ON DELETE CASCADE,
  operacion varchar(15) NOT NULL CHECK(operacion IN ('Venta','Pedido','Cotizacion')),
  monto_maximo numeric(18,2) NULL CHECK(monto_maximo>=0),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  motivo varchar(1000) NOT NULL,
  PRIMARY KEY(id_usuario,operacion)
);

ALTER TABLE solicitud_autorizacion_comercial
  ADD COLUMN operacion_destino varchar(15) NULL CHECK(operacion_destino IN ('Venta','Pedido','Cotizacion')),
  ADD COLUMN monto_operacion numeric(18,2) NULL CHECK(monto_operacion>=0),
  ADD COLUMN regla_version integer NULL,
  ADD COLUMN politica_decision jsonb NULL,
  ADD CONSTRAINT autorizacion_alcance_completo CHECK((operacion_destino IS NULL AND monto_operacion IS NULL) OR
    (operacion_destino IS NOT NULL AND monto_operacion IS NOT NULL));

CREATE TRIGGER trg_audit_regla_aprobacion AFTER INSERT OR UPDATE OR DELETE ON comercial_regla_aprobacion
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
CREATE TRIGGER trg_audit_limite_aprobador AFTER INSERT OR UPDATE OR DELETE ON comercial_limite_aprobador
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

INSERT INTO app_permission(code,description) VALUES('comercial.configurar_aprobaciones','Configurar reglas y límites de aprobación comercial');
INSERT INTO app_role_permission(role,permission_code) VALUES('admin','comercial.configurar_aprobaciones');
COMMENT ON COLUMN solicitud_autorizacion_comercial.monto_operacion IS 'Tope de total con impuestos declarado al solicitar y verificado contra total calculado al usar; no es el precio unitario de la excepción. NULL histórico.';
