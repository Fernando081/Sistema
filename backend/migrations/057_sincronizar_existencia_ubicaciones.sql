-- Mantiene el total por ubicaciones alineado con producto."Existencia".
-- Las entradas se reciben en GENERAL del almacén principal. Las salidas se
-- descuentan primero de GENERAL y después de las demás ubicaciones con stock.

CREATE OR REPLACE FUNCTION fn_sincronizar_existencia_ubicaciones()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_delta numeric(18,6);
  v_pendiente numeric(18,6);
  v_tomar numeric(18,6);
  v_id_general integer;
  v_fila record;
BEGIN
  IF COALESCE(current_setting('app.skip_location_stock_sync', true), 'false') = 'true' THEN
    RETURN NEW;
  END IF;

  v_delta := COALESCE(NEW."Existencia", 0)
    - CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE COALESCE(OLD."Existencia", 0) END;
  IF abs(v_delta) < 0.000001 THEN
    RETURN NEW;
  END IF;

  IF v_delta > 0 THEN
    SELECT u.id_ubicacion INTO v_id_general
      FROM almacen_ubicacion u
      JOIN almacen a ON a.id_almacen = u.id_almacen
     WHERE a.es_principal AND u.activa AND u.codigo = 'GENERAL'
     ORDER BY u.id_ubicacion
     LIMIT 1;
    IF v_id_general IS NULL THEN
      RAISE EXCEPTION 'No existe la ubicación GENERAL del almacén principal';
    END IF;
    INSERT INTO inventario_ubicacion(id_ubicacion,id_producto,cantidad)
    VALUES(v_id_general,NEW."IdProducto",v_delta)
    ON CONFLICT(id_ubicacion,id_producto) DO UPDATE
      SET cantidad=inventario_ubicacion.cantidad+excluded.cantidad,updated_at=now();
    RETURN NEW;
  END IF;

  v_pendiente := -v_delta;
  FOR v_fila IN
    SELECT i.id_ubicacion,i.cantidad
      FROM inventario_ubicacion i
      JOIN almacen_ubicacion u ON u.id_ubicacion=i.id_ubicacion
      JOIN almacen a ON a.id_almacen=u.id_almacen
     WHERE i.id_producto=NEW."IdProducto" AND i.cantidad>0
     ORDER BY (a.es_principal AND u.codigo='GENERAL') DESC,a.es_principal DESC,i.id_ubicacion
     FOR UPDATE OF i
  LOOP
    EXIT WHEN v_pendiente < 0.000001;
    v_tomar := LEAST(v_pendiente,v_fila.cantidad);
    UPDATE inventario_ubicacion
       SET cantidad=cantidad-v_tomar,updated_at=now()
     WHERE id_ubicacion=v_fila.id_ubicacion AND id_producto=NEW."IdProducto";
    v_pendiente := v_pendiente-v_tomar;
  END LOOP;
  IF v_pendiente >= 0.000001 THEN
    RAISE EXCEPTION 'Existencia por ubicaciones insuficiente para el producto %',NEW."IdProducto";
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_producto_ubicacion_insert ON producto;
CREATE TRIGGER trg_producto_ubicacion_insert
AFTER INSERT ON producto
FOR EACH ROW EXECUTE FUNCTION fn_sincronizar_existencia_ubicaciones();

DROP TRIGGER IF EXISTS trg_producto_ubicacion_update ON producto;
CREATE TRIGGER trg_producto_ubicacion_update
AFTER UPDATE OF "Existencia" ON producto
FOR EACH ROW EXECUTE FUNCTION fn_sincronizar_existencia_ubicaciones();

COMMENT ON FUNCTION fn_sincronizar_existencia_ubicaciones() IS
'Sincroniza automáticamente cada cambio de existencia global con el inventario físico por ubicación.';
