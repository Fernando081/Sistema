-- 033_cancelaciones_devoluciones_seguras.sql
-- Serializa cancelaciones/devoluciones, evita devoluciones excesivas y conserva
-- al usuario de la aplicación que ejecutó el movimiento.

ALTER TABLE auditoria_jsonb
  ADD COLUMN IF NOT EXISTS app_user_id integer REFERENCES auth_user(id_user) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION fn_audit_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_data jsonb := NULL;
  new_data jsonb := NULL;
  v_app_user_id integer := NULL;
BEGIN
  IF TG_OP = 'INSERT' THEN
    new_data := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    old_data := to_jsonb(OLD);
    new_data := to_jsonb(NEW);
  ELSE
    old_data := to_jsonb(OLD);
  END IF;

  BEGIN
    v_app_user_id := NULLIF(current_setting('app.current_user_id', true), '')::integer;
  EXCEPTION WHEN invalid_text_representation THEN
    v_app_user_id := NULL;
  END;

  INSERT INTO auditoria_jsonb
    (table_name, action, old_record, new_record, db_user, app_user_id, timestamp)
  VALUES
    (TG_TABLE_NAME::text, TG_OP, old_data, new_data, current_user, v_app_user_id, CURRENT_TIMESTAMP);

  RETURN COALESCE(NEW, OLD);
END;
$$;

ALTER TABLE devolucion_detalle
  ALTER COLUMN cantidad TYPE numeric(14,4) USING cantidad::numeric;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_devolucion_detalle_cantidad_positiva'
  ) THEN
    ALTER TABLE devolucion_detalle
      ADD CONSTRAINT ck_devolucion_detalle_cantidad_positiva CHECK (cantidad > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_devolucion_factura
  ON devolucion (id_factura, fecha DESC);

DROP PROCEDURE IF EXISTS sp_cancelar_factura(integer);

CREATE OR REPLACE PROCEDURE sp_cancelar_factura(
  p_id_venta integer,
  p_id_user integer DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_estatus varchar;
  v_tipo_comprobante char(1);
  v_item record;
  v_stock_anterior numeric;
  v_stock_resultante numeric;
  v_delta numeric;
  v_tipo_movimiento tipo_movimiento_enum;
BEGIN
  PERFORM set_config('app.current_user_id', COALESCE(p_id_user::text, ''), true);

  SELECT estatus::varchar, tipo_comprobante
    INTO v_estatus, v_tipo_comprobante
    FROM factura
   WHERE id_factura = p_id_venta
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;
  IF v_estatus = 'Cancelada' THEN
    RAISE EXCEPTION 'La factura ya se encuentra cancelada';
  END IF;
  IF EXISTS (SELECT 1 FROM devolucion WHERE id_factura = p_id_venta) THEN
    RAISE EXCEPTION 'La factura tiene devoluciones parciales; concílialas antes de cancelarla';
  END IF;

  -- Orden estable para evitar interbloqueos cuando dos movimientos comparten productos.
  PERFORM p."IdProducto"
    FROM producto p
   WHERE EXISTS (
     SELECT 1 FROM conceptofactura cf
      WHERE cf.id_factura = p_id_venta
        AND cf.id_producto = p."IdProducto"
   )
   ORDER BY p."IdProducto"
   FOR UPDATE OF p;

  FOR v_item IN
    SELECT id_producto, SUM(cantidad) AS cantidad, MAX(valor_unitario) AS valor_unitario
      FROM conceptofactura
     WHERE id_factura = p_id_venta AND id_producto IS NOT NULL
     GROUP BY id_producto
     ORDER BY id_producto
  LOOP
    SELECT "Existencia" INTO v_stock_anterior
      FROM producto WHERE "IdProducto" = v_item.id_producto;

    IF v_tipo_comprobante = 'E' THEN
      v_delta := -v_item.cantidad;
      v_tipo_movimiento := 'VENTA'::tipo_movimiento_enum;
    ELSE
      v_delta := v_item.cantidad;
      v_tipo_movimiento := 'ENTRADA POR DEVOLUCION'::tipo_movimiento_enum;
    END IF;

    v_stock_resultante := v_stock_anterior + v_delta;
    IF v_stock_resultante < 0 THEN
      RAISE EXCEPTION
        'No se puede cancelar: el producto % quedaría con stock negativo (%)',
        v_item.id_producto, v_stock_resultante;
    END IF;

    UPDATE producto SET "Existencia" = v_stock_resultante
     WHERE "IdProducto" = v_item.id_producto;

    INSERT INTO kardex (
      id_producto, fecha, tipo_movimiento, cantidad, stock_anterior,
      stock_resultante, precio_unitario, referencia, id_referencia
    ) VALUES (
      v_item.id_producto, NOW(), v_tipo_movimiento, v_delta, v_stock_anterior,
      v_stock_resultante, v_item.valor_unitario,
      CASE WHEN v_tipo_comprobante = 'E'
        THEN 'Cancelación de nota de crédito'
        ELSE 'Cancelación de factura'
      END,
      p_id_venta
    );
  END LOOP;

  UPDATE factura
     SET estatus = 'Cancelada'::estatus_factura_enum,
         saldo_pendiente = 0,
         comision_vendedor = 0
   WHERE id_factura = p_id_venta;

  DELETE FROM pago WHERE id_factura = p_id_venta;
  UPDATE factura SET id_factura_global = NULL WHERE id_factura_global = p_id_venta;
END;
$$;

CREATE OR REPLACE FUNCTION sp_procesar_devolucion_parcial(
  p_id_factura integer,
  p_metodo_reembolso varchar,
  p_articulos jsonb,
  p_id_user integer DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_id_devolucion integer;
  v_id_cliente integer;
  v_estatus varchar;
  v_tipo_comprobante char(1);
  v_total_factura numeric;
  v_comision_original numeric;
  v_monto_total numeric(14,2) := 0;
  v_item jsonb;
  v_id_producto integer;
  v_cantidad numeric(14,4);
  v_vendido numeric;
  v_devuelto numeric;
  v_total_linea numeric;
  v_precio_reembolso numeric;
  v_stock_anterior numeric;
BEGIN
  IF p_metodo_reembolso NOT IN ('Efectivo', 'Saldo a Favor') THEN
    RAISE EXCEPTION 'Método de reembolso no válido';
  END IF;
  IF p_articulos IS NULL OR jsonb_typeof(p_articulos) <> 'array' OR jsonb_array_length(p_articulos) = 0 THEN
    RAISE EXCEPTION 'Incluye al menos un artículo para devolver';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_articulos) item
     GROUP BY (item->>'idProducto')
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'No repitas productos dentro de la misma devolución';
  END IF;

  PERFORM set_config('app.current_user_id', COALESCE(p_id_user::text, ''), true);

  SELECT id_cliente, estatus::varchar, tipo_comprobante, total, comision_vendedor
    INTO v_id_cliente, v_estatus, v_tipo_comprobante, v_total_factura, v_comision_original
    FROM factura
   WHERE id_factura = p_id_factura
   FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Factura no encontrada'; END IF;
  IF v_id_cliente IS NULL THEN RAISE EXCEPTION 'La factura no tiene cliente asignado'; END IF;
  IF v_estatus = 'Cancelada' THEN RAISE EXCEPTION 'No se puede devolver sobre una factura cancelada'; END IF;
  IF v_tipo_comprobante <> 'I' THEN RAISE EXCEPTION 'Solo se admiten devoluciones sobre facturas de ingreso'; END IF;

  -- Valida tipos antes de crear cualquier registro o movimiento.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_articulos)
  LOOP
    BEGIN
      v_id_producto := (v_item->>'idProducto')::integer;
      v_cantidad := (v_item->>'cantidad')::numeric;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Artículo de devolución inválido';
    END;
    IF v_id_producto IS NULL OR v_cantidad IS NULL OR v_cantidad <= 0 THEN
      RAISE EXCEPTION 'Producto y cantidad deben ser válidos y mayores a cero';
    END IF;
  END LOOP;

  PERFORM p."IdProducto"
    FROM producto p
   WHERE p."IdProducto" IN (
     SELECT (value->>'idProducto')::integer FROM jsonb_array_elements(p_articulos)
   )
   ORDER BY p."IdProducto"
   FOR UPDATE;

  INSERT INTO devolucion (id_factura, metodo_reembolso)
  VALUES (p_id_factura, p_metodo_reembolso)
  RETURNING id_devolucion INTO v_id_devolucion;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(p_articulos)
    ORDER BY (value->>'idProducto')::integer
  LOOP
    v_id_producto := (v_item->>'idProducto')::integer;
    v_cantidad := (v_item->>'cantidad')::numeric;

    SELECT SUM(cantidad),
           SUM((importe - COALESCE(descuento, 0)) + COALESCE(importe_iva, 0) - COALESCE(importe_ret_isr, 0))
      INTO v_vendido, v_total_linea
      FROM conceptofactura
     WHERE id_factura = p_id_factura AND id_producto = v_id_producto;

    IF v_vendido IS NULL THEN
      RAISE EXCEPTION 'El producto % no pertenece a la factura', v_id_producto;
    END IF;

    SELECT COALESCE(SUM(dd.cantidad), 0)
      INTO v_devuelto
      FROM devolucion_detalle dd
      JOIN devolucion d ON d.id_devolucion = dd.id_devolucion
     WHERE d.id_factura = p_id_factura AND dd.id_producto = v_id_producto;

    IF v_devuelto + v_cantidad > v_vendido THEN
      RAISE EXCEPTION
        'La devolución del producto % excede lo vendido. Vendido: %, ya devuelto: %, solicitado: %',
        v_id_producto, v_vendido, v_devuelto, v_cantidad;
    END IF;

    v_precio_reembolso := ROUND(v_total_linea / v_vendido, 2);
    v_monto_total := v_monto_total + ROUND(v_cantidad * v_precio_reembolso, 2);

    INSERT INTO devolucion_detalle (id_devolucion, id_producto, cantidad, precio_unitario)
    VALUES (v_id_devolucion, v_id_producto, v_cantidad, v_precio_reembolso);

    SELECT "Existencia" INTO v_stock_anterior
      FROM producto WHERE "IdProducto" = v_id_producto;
    UPDATE producto SET "Existencia" = v_stock_anterior + v_cantidad
     WHERE "IdProducto" = v_id_producto;

    INSERT INTO kardex (
      id_producto, fecha, tipo_movimiento, cantidad, stock_anterior,
      stock_resultante, precio_unitario, referencia, id_referencia
    ) VALUES (
      v_id_producto, CURRENT_TIMESTAMP, 'ENTRADA POR DEVOLUCION'::tipo_movimiento_enum,
      v_cantidad, v_stock_anterior, v_stock_anterior + v_cantidad,
      v_precio_reembolso, 'Devolución parcial', p_id_factura
    );
  END LOOP;

  IF v_monto_total <= 0 THEN RAISE EXCEPTION 'El monto de la devolución debe ser mayor a cero'; END IF;
  UPDATE devolucion SET monto_total = v_monto_total WHERE id_devolucion = v_id_devolucion;

  IF p_metodo_reembolso = 'Saldo a Favor' THEN
    UPDATE cliente SET saldo_a_favor = saldo_a_favor + v_monto_total
     WHERE "IdCliente" = v_id_cliente;
  ELSE
    INSERT INTO gasto (concepto, monto, categoria, metodo_pago, id_user)
    VALUES (
      'DEVOLUCIÓN EFECTIVO FACTURA ' || p_id_factura,
      v_monto_total, 'Devoluciones y Reembolsos', 'Efectivo', p_id_user
    );
  END IF;

  IF COALESCE(v_total_factura, 0) > 0 AND COALESCE(v_comision_original, 0) > 0 THEN
    UPDATE factura
       SET comision_vendedor = GREATEST(
         0,
         ROUND(comision_vendedor - (v_comision_original * v_monto_total / v_total_factura), 2)
       )
     WHERE id_factura = p_id_factura;
  END IF;

  RETURN v_id_devolucion;
END;
$$;

COMMENT ON PROCEDURE sp_cancelar_factura(integer, integer) IS
  'Cancela una factura con bloqueo de filas, revierte inventario según el tipo y conserva el usuario.';
COMMENT ON FUNCTION sp_procesar_devolucion_parcial(integer, varchar, jsonb, integer) IS
  'Devuelve solo cantidades originalmente vendidas y calcula el reembolso desde la factura.';
