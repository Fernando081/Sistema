-- Q02: métricas operativas de los últimos 90 días, sin constantes ni enlaces supuestos.
-- Conserva nombres API; dias_cuentas_por_pagar ahora es plazo efectivo ponderado,
-- no el DPO contable. La interfaz identifica explícitamente esta definición.
-- PostgreSQL restringe search_path al crear/refrescar vistas materializadas.
-- La función heredada resuelve sus tablas en el esquema operativo explícito.
ALTER FUNCTION fn_get_margen_productos() SET search_path TO public, pg_temp;
DROP MATERIALIZED VIEW IF EXISTS mv_operaciones_avanzadas;
CREATE MATERIALIZED VIEW mv_operaciones_avanzadas AS
WITH pedidos AS (
  SELECT sum(d.cantidad) AS solicitado, sum(d.cantidad_surtida) AS surtido
  FROM pedido_venta p JOIN pedido_venta_detalle d USING(id_pedido)
  WHERE p.estado NOT IN ('Borrador','Cancelado')
    AND p.created_at >= CURRENT_DATE - INTERVAL '89 days'
    AND p.created_at < CURRENT_DATE + INTERVAL '1 day'
), cotizaciones AS (
  SELECT c.id_cotizacion, EXISTS (
    SELECT 1 FROM factura f
    LEFT JOIN pedido_venta pv ON pv.id_pedido=f.id_pedido
    WHERE COALESCE(f.id_cotizacion,pv.id_cotizacion)=c.id_cotizacion AND f.estatus::text<>'Cancelada'
      AND COALESCE(f.tipo_comprobante,'I')='I'
  ) AS convertida
  FROM cotizacion c
  WHERE c.fecha_emision >= CURRENT_DATE - INTERVAL '89 days'
    AND c.fecha_emision < CURRENT_DATE + INTERVAL '1 day'
), ventas AS (
  SELECT sum(cf.cantidad) AS cantidad
  FROM conceptofactura cf JOIN factura f USING(id_factura)
  WHERE f.estatus::text<>'Cancelada' AND COALESCE(f.tipo_comprobante,'I')='I'
    AND f.fecha_emision >= CURRENT_DATE - INTERVAL '89 days'
    AND f.fecha_emision < CURRENT_DATE + INTERVAL '1 day'
), devoluciones AS (
  SELECT to_char(d.fecha,'YYYY-MM') AS mes, sum(dd.cantidad) AS cantidad
  FROM devolucion d JOIN devolucion_detalle dd USING(id_devolucion)
  JOIN factura f ON f.id_factura=d.id_factura
  WHERE f.estatus::text<>'Cancelada' AND COALESCE(f.tipo_comprobante,'I')='I'
    AND d.fecha >= CURRENT_DATE - INTERVAL '89 days'
    AND d.fecha < CURRENT_DATE + INTERVAL '1 day'
  GROUP BY to_char(d.fecha,'YYYY-MM')
), marcas AS (
  SELECT p."Marca" AS marca,
    CASE WHEN bool_and(m.costo_conocido) THEN sum(m.utilidad_bruta) END AS rentabilidad
  FROM fn_get_margen_productos() m JOIN producto p ON p."IdProducto"=m.id_producto
  GROUP BY p."Marca"
)
SELECT 1 AS id,
  (SELECT 100.0*count(*) FILTER(WHERE convertida)/NULLIF(count(*),0) FROM cotizaciones)
    AS tasa_conversion_cotizaciones,
  (SELECT 100.0*COALESCE(sum(cantidad),0)/(SELECT NULLIF(cantidad,0) FROM ventas) FROM devoluciones)
    AS tasa_devoluciones,
  (SELECT 100.0*surtido/NULLIF(solicitado,0) FROM pedidos) AS tasa_cumplimiento,
  (SELECT avg(distintos) FROM (
    SELECT count(DISTINCT cf.id_producto) AS distintos
    FROM conceptofactura cf JOIN factura f USING(id_factura)
    WHERE f.estatus::text<>'Cancelada' AND COALESCE(f.tipo_comprobante,'I')='I'
      AND f.fecha_emision >= CURRENT_DATE - INTERVAL '89 days'
      AND f.fecha_emision < CURRENT_DATE + INTERVAL '1 day'
    GROUP BY f.id_factura
  ) v) AS indice_ventas_cruzadas,
  (SELECT COALESCE(json_agg(json_build_object('proveedor','Sin atribución a proveedor',
    'marca',marca,'rentabilidad',rentabilidad) ORDER BY marca),'[]'::json) FROM marcas)
    AS rentabilidad_proveedor_marca,
  (SELECT COALESCE(json_agg(json_build_object('mes',mes,'valor',cantidad) ORDER BY mes),'[]'::json)
    FROM devoluciones) AS tasa_de_devoluciones_historico;
CREATE UNIQUE INDEX idx_mv_operaciones_avanzadas ON mv_operaciones_avanzadas(id);

-- Solo pagos vigentes a facturas/compra no canceladas; cada pago pesa por su monto.
-- Incluye flujo clásico y profesional; no incluye anticipos ni créditos como efectivo.
CREATE OR REPLACE FUNCTION fn_plazo_pago_proveedores_90d()
RETURNS numeric LANGUAGE sql STABLE SET search_path TO public, pg_temp AS $$
  WITH pagos AS (
    SELECT (p.fecha-f.fecha_emision) AS dias,p.monto
    FROM factura_proveedor_pago p JOIN factura_proveedor f USING(id_factura_proveedor)
    WHERE p.estado='Activo' AND f.estado<>'Cancelada' AND p.fecha>=f.fecha_emision
      AND p.fecha>=CURRENT_DATE-89 AND p.fecha<=CURRENT_DATE
    UNION ALL
    SELECT (p.fecha_pago::date-c.fecha_compra::date),p.monto
    FROM pago_proveedor p JOIN compra c USING(id_compra)
    WHERE c.estatus::text NOT IN ('Cancelada','Cancelado')
      AND p.fecha_pago::date>=c.fecha_compra::date
      AND p.fecha_pago::date>=CURRENT_DATE-89 AND p.fecha_pago::date<=CURRENT_DATE
  ) SELECT sum(dias*monto)/NULLIF(sum(monto),0) FROM pagos WHERE monto>0;
$$;

DROP MATERIALIZED VIEW IF EXISTS mv_clientes_cobranza;
CREATE MATERIALIZED VIEW mv_clientes_cobranza AS
WITH historial AS (
  SELECT id_cliente,count(*) AS compras,sum(total) AS ingresos,
    sum(CASE WHEN saldo_pendiente>0 AND fecha_emision>=CURRENT_DATE-INTERVAL '30 days'
      THEN saldo_pendiente ELSE 0 END) AS deuda_0_30,
    sum(CASE WHEN saldo_pendiente>0 AND fecha_emision<CURRENT_DATE-INTERVAL '30 days'
      AND fecha_emision>=CURRENT_DATE-INTERVAL '60 days' THEN saldo_pendiente ELSE 0 END) AS deuda_31_60,
    sum(CASE WHEN saldo_pendiente>0 AND fecha_emision<CURRENT_DATE-INTERVAL '60 days'
      THEN saldo_pendiente ELSE 0 END) AS deuda_60_mas
  FROM factura WHERE estatus::text<>'Cancelada' AND COALESCE(tipo_comprobante,'I')='I'
  GROUP BY id_cliente
)
SELECT 1 AS id,
  100.0*count(*) FILTER(WHERE h.compras>1)/NULLIF(count(*),0) AS tasa_retencion_clientes,
  avg(COALESCE(h.ingresos,0)) AS valor_tiempo_vida,
  fn_plazo_pago_proveedores_90d() AS dias_cuentas_por_pagar,
  json_build_array(
    json_build_object('rango','0-30 días','monto',COALESCE(sum(h.deuda_0_30),0)),
    json_build_object('rango','31-60 días','monto',COALESCE(sum(h.deuda_31_60),0)),
    json_build_object('rango','> 60 días','monto',COALESCE(sum(h.deuda_60_mas),0))
  ) AS cuentas_por_cobrar
FROM cliente c LEFT JOIN historial h ON h.id_cliente=c."IdCliente";
CREATE UNIQUE INDEX idx_mv_clientes_cobranza ON mv_clientes_cobranza(id);
