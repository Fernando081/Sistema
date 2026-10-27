-- Evita contabilizar un movimiento gestionado por el servicio como ajuste manual.
-- El indicador es LOCAL a la transacción; no deshabilita triggers ni sincronización física.
CREATE OR REPLACE FUNCTION public.fn_kardex_cambios_producto()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF OLD."PrecioUnitario" <> NEW."PrecioUnitario" THEN
    INSERT INTO kardex(id_producto,tipo_movimiento,cantidad,stock_anterior,stock_resultante,precio_unitario,referencia)
    VALUES(NEW."IdProducto",'CAMBIO_PRECIO',0,NEW."Existencia",NEW."Existencia",NEW."PrecioUnitario",'Actualización Manual de Precio');
  END IF;
  IF OLD."Existencia" <> NEW."Existencia"
     AND COALESCE(current_setting('app.stock_movement_managed',true),'false') <> 'true' THEN
    INSERT INTO kardex(id_producto,tipo_movimiento,cantidad,stock_anterior,stock_resultante,precio_unitario,referencia)
    VALUES(NEW."IdProducto",'AJUSTE_MANUAL_STOCK',NEW."Existencia"-OLD."Existencia",OLD."Existencia",NEW."Existencia",NEW."PrecioUnitario",'Ajuste directo de Inventario');
  END IF;
  RETURN NEW;
END;
$$;
