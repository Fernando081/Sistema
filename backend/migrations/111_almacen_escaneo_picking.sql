-- Verificación de recogida; no altera inventario, reservas o facturación.
INSERT INTO app_permission(code,description) VALUES('inventario.escanear','Consultar y verificar recogida de picking mediante códigos en almacén');
INSERT INTO app_role_permission(role,permission_code) VALUES('admin','inventario.escanear');
CREATE TABLE almacen_picking_verificacion (
 id uuid PRIMARY KEY,
 id_pedido integer NOT NULL REFERENCES pedido_venta(id_pedido) ON DELETE RESTRICT,
 id_surtido bigint NOT NULL REFERENCES pedido_surtido_ubicacion(id_surtido) ON DELETE RESTRICT,
 accion varchar(10) NOT NULL CHECK(accion IN('Verificar','Anular')),
 cantidad numeric(18,6) NOT NULL CHECK(cantidad>0),
 id_anulada uuid UNIQUE REFERENCES almacen_picking_verificacion(id) ON DELETE RESTRICT,
 metodo varchar(10) CHECK(metodo IN('Manual','Lector','Camara')), motivo varchar(300),
 id_actor integer NOT NULL REFERENCES auth_user(id_user) ON DELETE RESTRICT,
 huella char(64) NOT NULL CHECK(huella ~ '^[a-f0-9]{64}$'),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=8192),
 creada_en timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((accion='Verificar' AND id_anulada IS NULL AND metodo IS NOT NULL AND motivo IS NULL) OR
       (accion='Anular' AND id_anulada IS NOT NULL AND metodo IS NULL AND length(trim(motivo))>0))
);
CREATE INDEX almacen_verificacion_pedido ON almacen_picking_verificacion(id_pedido,creada_en DESC,id);
CREATE INDEX almacen_verificacion_surtido ON almacen_picking_verificacion(id_surtido);
CREATE FUNCTION fn_almacen_verificar_picking() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pedido record; partida record; original record; acumulado numeric;
BEGIN
 SELECT estado INTO pedido FROM pedido_venta WHERE id_pedido=NEW.id_pedido FOR UPDATE;
 SELECT * INTO partida FROM pedido_surtido_ubicacion WHERE id_surtido=NEW.id_surtido FOR UPDATE;
 IF partida.id_surtido IS NULL OR partida.id_pedido<>NEW.id_pedido OR partida.estado<>'Reservada'
    OR pedido.estado NOT IN('Parcialmente surtido','Surtido') THEN
   RAISE EXCEPTION 'El picking no está disponible para verificación';
 END IF;
 IF NEW.accion='Anular' THEN
   SELECT * INTO original FROM almacen_picking_verificacion WHERE id=NEW.id_anulada;
   IF original.id IS NULL OR original.accion<>'Verificar' OR original.id_pedido<>NEW.id_pedido
      OR original.id_surtido<>NEW.id_surtido OR original.cantidad<>NEW.cantidad THEN
     RAISE EXCEPTION 'La anulación no corresponde a la verificación';
   END IF;
 END IF;
 SELECT coalesce(sum(CASE accion WHEN 'Verificar' THEN cantidad ELSE -cantidad END),0)
   INTO acumulado FROM almacen_picking_verificacion WHERE id_surtido=NEW.id_surtido;
 acumulado=acumulado+CASE NEW.accion WHEN 'Verificar' THEN NEW.cantidad ELSE -NEW.cantidad END;
 IF acumulado<0 OR acumulado>partida.cantidad THEN RAISE EXCEPTION 'La cantidad verificada supera el picking'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER almacen_verificacion_vinculo BEFORE INSERT ON almacen_picking_verificacion FOR EACH ROW EXECUTE FUNCTION fn_almacen_verificar_picking();
ALTER TABLE almacen_picking_verificacion ENABLE ALWAYS TRIGGER almacen_verificacion_vinculo;
CREATE TRIGGER almacen_verificacion_conservar BEFORE UPDATE OR DELETE OR TRUNCATE ON almacen_picking_verificacion FOR EACH STATEMENT EXECUTE FUNCTION fn_crm_secuencia_conservar();
ALTER TABLE almacen_picking_verificacion ENABLE ALWAYS TRIGGER almacen_verificacion_conservar;
CREATE TRIGGER almacen_verificacion_auditoria AFTER INSERT ON almacen_picking_verificacion FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
