-- Enlace explícito para nuevas devoluciones en efectivo. No se infieren ni
-- modifican reembolsos históricos por descripción, importe o fecha.
ALTER TABLE devolucion ADD COLUMN id_gasto_reembolso integer REFERENCES gasto(id_gasto);
CREATE UNIQUE INDEX ux_devolucion_gasto_reembolso ON devolucion(id_gasto_reembolso)
  WHERE id_gasto_reembolso IS NOT NULL;
CREATE INDEX ix_factura_gasto_reembolso ON factura(id_gasto_reembolso)
  WHERE id_gasto_reembolso IS NOT NULL;
COMMENT ON COLUMN devolucion.id_gasto_reembolso IS
  'Gasto creado en la misma transacción de una nueva devolución en efectivo; NULL histórico requiere conciliación.';

CREATE OR REPLACE FUNCTION sp_procesar_devolucion_parcial(
  p_id_factura integer, p_metodo_reembolso varchar, p_articulos jsonb, p_id_user integer DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_id integer; v_factura factura%ROWTYPE; v_item jsonb;
  v_producto integer; v_cantidad numeric; v_vendido numeric; v_devuelto numeric;
  v_importe_previo numeric; v_total_linea numeric; v_importe numeric;
  v_total numeric(14,2):=0; v_stock numeric; v_gasto integer; v_managed text;
BEGIN
  IF p_metodo_reembolso IS NULL OR p_metodo_reembolso NOT IN ('Efectivo','Saldo a Favor') THEN
    RAISE EXCEPTION 'Método de reembolso no válido';
  END IF;
  IF p_articulos IS NULL OR jsonb_typeof(p_articulos)<>'array' OR jsonb_array_length(p_articulos)=0 THEN
    RAISE EXCEPTION 'Incluye al menos un artículo para devolver';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_articulos) x GROUP BY x->>'idProducto' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'No repitas productos dentro de la devolución';
  END IF;
  PERFORM set_config('app.current_user_id',coalesce(p_id_user::text,''),true);
  SELECT * INTO v_factura FROM factura WHERE id_factura=p_id_factura FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Factura no encontrada'; END IF;
  IF v_factura.estatus::text='Cancelada' OR v_factura.tipo_comprobante<>'I' THEN
    RAISE EXCEPTION 'Solo se admiten devoluciones sobre facturas de ingreso vigentes';
  END IF;
  IF v_factura.id_cliente IS NULL THEN RAISE EXCEPTION 'La factura no tiene cliente asignado'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_articulos) LOOP
    v_producto:=(v_item->>'idProducto')::integer;
    v_cantidad:=(v_item->>'cantidad')::numeric;
    IF v_producto IS NULL OR v_producto<1 OR v_cantidad IS NULL OR v_cantidad<=0 OR v_cantidad<>round(v_cantidad,4) THEN
      RAISE EXCEPTION 'Producto y cantidad deben ser válidos (máximo cuatro decimales)';
    END IF;
  END LOOP;
  PERFORM p."IdProducto" FROM producto p WHERE p."IdProducto" IN
    (SELECT (value->>'idProducto')::integer FROM jsonb_array_elements(p_articulos))
    ORDER BY p."IdProducto" FOR UPDATE;
  INSERT INTO devolucion(id_factura,metodo_reembolso) VALUES(p_id_factura,p_metodo_reembolso)
    RETURNING id_devolucion INTO v_id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_articulos) ORDER BY (value->>'idProducto')::integer LOOP
    v_producto:=(v_item->>'idProducto')::integer;
    v_cantidad:=(v_item->>'cantidad')::numeric;
    SELECT sum(cantidad), sum(importe-coalesce(descuento,0)+coalesce(importe_iva,0)-coalesce(importe_ret_isr,0))
      INTO v_vendido,v_total_linea FROM conceptofactura WHERE id_factura=p_id_factura AND id_producto=v_producto;
    IF v_vendido IS NULL THEN RAISE EXCEPTION 'El producto % no pertenece a la factura',v_producto; END IF;
    SELECT coalesce(sum(dd.cantidad),0),coalesce(sum(dd.importe_reembolso),0)
      INTO v_devuelto,v_importe_previo FROM devolucion_detalle dd
      JOIN devolucion d ON d.id_devolucion=dd.id_devolucion
      WHERE d.id_factura=p_id_factura AND dd.id_producto=v_producto;
    IF v_devuelto+v_cantidad>v_vendido THEN RAISE EXCEPTION 'La devolución excede la cantidad vendida del producto %',v_producto; END IF;
    v_importe:=round(v_total_linea*(v_devuelto+v_cantidad)/v_vendido,2)-v_importe_previo;
    IF v_importe<0 THEN RAISE EXCEPTION 'Reembolsos históricos inconsistentes; concilia la factura'; END IF;
    v_total:=v_total+v_importe;
    INSERT INTO devolucion_detalle(id_devolucion,id_producto,cantidad,precio_unitario,importe_reembolso)
      VALUES(v_id,v_producto,v_cantidad,round(v_importe/v_cantidad,2),v_importe);
    SELECT "Existencia" INTO v_stock FROM producto WHERE "IdProducto"=v_producto;
    v_managed:=current_setting('app.stock_movement_managed',true);
    PERFORM set_config('app.stock_movement_managed','true',true);
    UPDATE producto SET "Existencia"=v_stock+v_cantidad WHERE "IdProducto"=v_producto;
    PERFORM set_config('app.stock_movement_managed',coalesce(nullif(v_managed,''),'false'),true);
    INSERT INTO kardex(id_producto,fecha,tipo_movimiento,cantidad,stock_anterior,stock_resultante,precio_unitario,referencia,id_referencia)
      VALUES(v_producto,now(),'ENTRADA POR DEVOLUCION'::tipo_movimiento_enum,v_cantidad,v_stock,v_stock+v_cantidad,
        round(v_importe/v_cantidad,2),'Devolución parcial',p_id_factura);
  END LOOP;
  UPDATE devolucion SET monto_total=v_total WHERE id_devolucion=v_id;
  IF p_metodo_reembolso='Saldo a Favor' THEN
    UPDATE cliente SET saldo_a_favor=saldo_a_favor+v_total WHERE "IdCliente"=v_factura.id_cliente;
  ELSIF v_total>0 THEN
    INSERT INTO gasto(concepto,monto,categoria,metodo_pago,id_user)
      VALUES('DEVOLUCIÓN EFECTIVO FACTURA '||p_id_factura,v_total,'Devoluciones y Reembolsos','Efectivo',p_id_user)
      RETURNING id_gasto INTO v_gasto;
    UPDATE devolucion SET id_gasto_reembolso=v_gasto WHERE id_devolucion=v_id;
  END IF;
  RETURN v_id;
END;
$$;

-- Cancelar una factura/nota también escribe su propio kardex: conservar la
-- sincronización física y evitar la entrada adicional de ajuste manual (085).
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
  v_managed text;
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

    v_managed:=current_setting('app.stock_movement_managed',true);
    PERFORM set_config('app.stock_movement_managed','true',true);
    UPDATE producto SET "Existencia" = v_stock_resultante
     WHERE "IdProducto" = v_item.id_producto;
    PERFORM set_config('app.stock_movement_managed',coalesce(nullif(v_managed,''),'false'),true);

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
