-- Capturas reales diarias: no reconstruye ni inventa días anteriores.
-- Valoración: existencia física por costo medio ponderado de entradas COMPRA.
-- No usa precio de venta ni el supuesto histórico PrecioUnitario * 0.6.
CREATE TABLE IF NOT EXISTS analytics_inventario_diario (
  fecha date PRIMARY KEY,
  capturado_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  valor numeric(24,6),
  productos_sin_costo integer NOT NULL CHECK(productos_sin_costo>=0)
);

CREATE OR REPLACE FUNCTION fn_capturar_valor_inventario_diario()
RETURNS void LANGUAGE sql SET search_path TO public, pg_temp AS $$
  WITH costos AS (
    SELECT id_producto,CASE WHEN bool_and(precio_unitario IS NOT NULL AND precio_unitario>=0)
      THEN sum(cantidad*precio_unitario)/NULLIF(sum(cantidad),0) END AS costo
    FROM kardex WHERE tipo_movimiento::text='COMPRA' AND cantidad>0
      AND fecha<=now()
    GROUP BY id_producto
  ), valoracion AS (
    SELECT count(*) FILTER(WHERE p."Existencia" IS NULL OR p."Existencia"<0
      OR (p."Existencia">0 AND c.costo IS NULL)) AS desconocidos,
      COALESCE(sum(p."Existencia"*c.costo),0) AS valor
    FROM producto p LEFT JOIN costos c ON c.id_producto=p."IdProducto"
  ) INSERT INTO analytics_inventario_diario(fecha,valor,productos_sin_costo)
    SELECT (now() AT TIME ZONE 'America/Mexico_City')::date,
      CASE WHEN desconocidos=0 THEN valor END,desconocidos FROM valoracion
    ON CONFLICT(fecha) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION fn_gmroi_90d()
RETURNS numeric LANGUAGE sql STABLE SET search_path TO public, pg_temp AS $$
  WITH periodo AS (
    SELECT (now() AT TIME ZONE 'America/Mexico_City')::date AS hoy
  ), promedio AS (
    SELECT CASE WHEN count(*)=90 AND count(valor)=90 THEN avg(valor) END AS valor
    FROM analytics_inventario_diario,periodo WHERE fecha BETWEEN hoy-89 AND hoy
  ), ventas AS (
    SELECT cf.id_factura,cf.id_producto,sum(cf.cantidad) AS cantidad,
      sum(cf.importe-COALESCE(cf.descuento,0)) AS ingreso,
      sum(cf.cantidad*cf.costo_unitario_snapshot) AS costo,
      bool_and(cf.costo_unitario_snapshot IS NOT NULL) AS conocido
    FROM conceptofactura cf JOIN factura f USING(id_factura),periodo
    WHERE f.estatus::text<>'Cancelada' AND COALESCE(f.tipo_comprobante,'I')='I'
      AND (f.fecha_emision AT TIME ZONE 'America/Mexico_City')::date BETWEEN hoy-89 AND hoy
    GROUP BY cf.id_factura,cf.id_producto
  ), devoluciones AS (
    SELECT d.id_factura,dd.id_producto,sum(dd.cantidad) AS cantidad
    FROM devolucion d JOIN devolucion_detalle dd USING(id_devolucion)
    GROUP BY d.id_factura,dd.id_producto
  ), notas AS (
    SELECT f.id_factura_origen,cf.id_producto,sum(cf.cantidad) AS cantidad,
      sum(cf.importe-COALESCE(cf.descuento,0)) AS ingreso
    FROM factura f JOIN conceptofactura cf USING(id_factura)
    WHERE f.tipo_comprobante='E' AND f.estatus::text<>'Cancelada'
    GROUP BY f.id_factura_origen,cf.id_producto
  ), margen AS (
    SELECT CASE WHEN COALESCE(bool_and(v.conocido),true) THEN COALESCE(sum(
      v.ingreso-round(v.ingreso*COALESCE(d.cantidad,0)/NULLIF(v.cantidad,0),2)-COALESCE(n.ingreso,0)
      -v.costo*(v.cantidad-COALESCE(d.cantidad,0)-COALESCE(n.cantidad,0))/NULLIF(v.cantidad,0)
    ),0) END AS valor
    FROM ventas v LEFT JOIN devoluciones d USING(id_factura,id_producto)
    LEFT JOIN notas n ON n.id_factura_origen=v.id_factura AND n.id_producto=v.id_producto
  ) SELECT m.valor/NULLIF(p.valor,0) FROM margen m CROSS JOIN promedio p;
$$;

CREATE OR REPLACE FUNCTION sp_refresh_analytics_views()
RETURNS void LANGUAGE plpgsql SET search_path TO public, pg_temp AS $$
BEGIN
  PERFORM fn_capturar_valor_inventario_diario();
  REFRESH MATERIALIZED VIEW mv_ventas_facturacion;
  REFRESH MATERIALIZED VIEW mv_inventario_almacen;
  REFRESH MATERIALIZED VIEW mv_clientes_cobranza;
  REFRESH MATERIALIZED VIEW mv_operaciones_avanzadas;
END;
$$;
SELECT fn_capturar_valor_inventario_diario();
