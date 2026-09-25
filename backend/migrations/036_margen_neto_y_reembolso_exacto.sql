-- Importes exactos por devolución: distribuir centavos al acumular cantidades
-- impide devolver 9.99 o 10.02 por una venta de 10.00 en tres partes.
ALTER TABLE devolucion_detalle ADD COLUMN IF NOT EXISTS importe_reembolso numeric(14,2);
UPDATE devolucion_detalle SET importe_reembolso=round(cantidad*precio_unitario,2)
 WHERE importe_reembolso IS NULL;

CREATE OR REPLACE FUNCTION sp_procesar_devolucion_parcial(
  p_id_factura integer, p_metodo_reembolso varchar, p_articulos jsonb, p_id_user integer DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_id integer; v_factura factura%ROWTYPE; v_item jsonb;
  v_producto integer; v_cantidad numeric; v_vendido numeric; v_devuelto numeric;
  v_importe_previo numeric; v_total_linea numeric; v_importe numeric;
  v_total numeric(14,2):=0; v_stock numeric;
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
    UPDATE producto SET "Existencia"=v_stock+v_cantidad WHERE "IdProducto"=v_producto;
    INSERT INTO kardex(id_producto,fecha,tipo_movimiento,cantidad,stock_anterior,stock_resultante,precio_unitario,referencia,id_referencia)
      VALUES(v_producto,now(),'ENTRADA POR DEVOLUCION'::tipo_movimiento_enum,v_cantidad,v_stock,v_stock+v_cantidad,
        round(v_importe/v_cantidad,2),'Devolución parcial',p_id_factura);
  END LOOP;
  UPDATE devolucion SET monto_total=v_total WHERE id_devolucion=v_id;
  IF p_metodo_reembolso='Saldo a Favor' THEN
    UPDATE cliente SET saldo_a_favor=saldo_a_favor+v_total WHERE "IdCliente"=v_factura.id_cliente;
  ELSIF v_total>0 THEN
    INSERT INTO gasto(concepto,monto,categoria,metodo_pago,id_user)
      VALUES('DEVOLUCIÓN EFECTIVO FACTURA '||p_id_factura,v_total,'Devoluciones y Reembolsos','Efectivo',p_id_user);
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION fn_get_margen_productos()
RETURNS TABLE(id_producto int,codigo varchar,descripcion varchar,cantidad_vendida numeric,
  ingresos_totales numeric,costo_total numeric,utilidad_bruta numeric,margen_porcentaje numeric,costo_conocido boolean)
LANGUAGE sql STABLE AS $$
WITH ventas AS (
  SELECT cf.id_factura,cf.id_producto,sum(cf.cantidad) AS cantidad,
    sum(cf.importe-coalesce(cf.descuento,0)) AS neto,
    sum(cf.cantidad*cf.costo_unitario_snapshot) AS costo,
    bool_and(cf.costo_unitario_snapshot IS NOT NULL) AS conocido
  FROM conceptofactura cf JOIN factura f ON f.id_factura=cf.id_factura
  WHERE f.estatus::text<>'Cancelada' AND coalesce(f.tipo_comprobante,'I')='I' AND cf.id_producto IS NOT NULL
  GROUP BY cf.id_factura,cf.id_producto
), devoluciones AS (
  SELECT d.id_factura,dd.id_producto,sum(dd.cantidad) AS cantidad
  FROM devolucion d JOIN devolucion_detalle dd ON dd.id_devolucion=d.id_devolucion
  GROUP BY d.id_factura,dd.id_producto
), notas AS (
  SELECT f.id_factura_origen,cf.id_producto,sum(cf.cantidad) AS cantidad,
    sum(cf.importe-coalesce(cf.descuento,0)) AS neto
  FROM factura f JOIN conceptofactura cf ON cf.id_factura=f.id_factura
  WHERE f.tipo_comprobante='E' AND f.estatus::text<>'Cancelada' AND f.id_factura_origen IS NOT NULL
  GROUP BY f.id_factura_origen,cf.id_producto
), netas AS (
  SELECT v.id_producto,
    v.cantidad-coalesce(d.cantidad,0)-coalesce(n.cantidad,0) AS cantidad,
    v.neto-round(v.neto*coalesce(d.cantidad,0)/nullif(v.cantidad,0),2)-coalesce(n.neto,0) AS ingreso,
    v.costo*(v.cantidad-coalesce(d.cantidad,0)-coalesce(n.cantidad,0))/nullif(v.cantidad,0) AS costo,
    v.conocido
  FROM ventas v LEFT JOIN devoluciones d USING(id_factura,id_producto)
  LEFT JOIN notas n ON n.id_factura_origen=v.id_factura AND n.id_producto=v.id_producto
), totales AS (
  SELECT n.id_producto,sum(n.cantidad) AS cantidad,sum(n.ingreso) AS ingreso,
    CASE WHEN bool_and(n.conocido) THEN sum(n.costo) END AS costo,bool_and(n.conocido) AS conocido
  FROM netas n GROUP BY n.id_producto
)
SELECT p."IdProducto",p."Codigo",p."Descripcion",t.cantidad,t.ingreso,t.costo,
  t.ingreso-t.costo,(t.ingreso-t.costo)/nullif(t.ingreso,0)*100,t.conocido
FROM totales t JOIN producto p ON p."IdProducto"=t.id_producto ORDER BY 7 DESC NULLS LAST;
$$;

CREATE OR REPLACE FUNCTION public.fn_get_detalle_factura(p_id_factura integer)
RETURNS TABLE(id_concepto integer,id_producto integer,codigo_producto varchar,descripcion_producto text,
  unidad varchar,cantidad numeric,cantidad_devuelta numeric,precio_unitario numeric,importe numeric,
  pct_iva numeric,importe_iva numeric,pct_ret_isr numeric,importe_ret_isr numeric)
LANGUAGE sql STABLE AS $$
SELECT d.id_concepto,p."IdProducto",p."Codigo",d.descripcion::text,d.unidad_sat,d.cantidad,
  (coalesce((SELECT sum(dd.cantidad) FROM devolucion_detalle dd JOIN devolucion dev ON dev.id_devolucion=dd.id_devolucion
     WHERE dev.id_factura=p_id_factura AND dd.id_producto=d.id_producto),0)
   +coalesce((SELECT sum(nc.cantidad) FROM conceptofactura nc JOIN factura nf ON nf.id_factura=nc.id_factura
     WHERE nf.id_factura_origen=p_id_factura AND nf.estatus::text<>'Cancelada' AND nc.id_producto=d.id_producto),0))::numeric,
  d.valor_unitario,d.importe,d.tasa_iva,d.importe_iva,d.tasa_ret_isr,d.importe_ret_isr
FROM conceptofactura d LEFT JOIN producto p ON p."IdProducto"=d.id_producto
WHERE d.id_factura=p_id_factura ORDER BY d.id_concepto;
$$;
