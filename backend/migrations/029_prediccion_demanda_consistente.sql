-- 029_prediccion_demanda_consistente.sql
-- Pronóstico explicable con semanas sin venta y exclusión de devoluciones.

DROP MATERIALIZED VIEW IF EXISTS vw_prediccion_demanda;

CREATE MATERIALIZED VIEW vw_prediccion_demanda AS
WITH semanas AS (
  SELECT generate_series(0, 25) AS semana_ord
), ventas AS (
  SELECT cf.id_producto,
         floor((CURRENT_DATE - f.fecha_emision::date) / 7.0)::int AS antiguedad_semana,
         SUM(cf.cantidad) AS unidades
    FROM conceptofactura cf
    JOIN factura f ON f.id_factura = cf.id_factura
   WHERE f.estatus::text <> 'Cancelada'
     AND COALESCE(f.tipo_comprobante, 'I') = 'I'
     AND f.fecha_emision >= CURRENT_DATE - INTERVAL '182 days'
   GROUP BY cf.id_producto, antiguedad_semana
), serie AS (
  SELECT p."IdProducto" AS id_producto,
         26 - s.semana_ord AS semana_ord,
         COALESCE(v.unidades, 0) AS unidades_semana
    FROM producto p CROSS JOIN semanas s
    LEFT JOIN ventas v ON v.id_producto = p."IdProducto"
                       AND v.antiguedad_semana = s.semana_ord
), estadistica AS (
  SELECT id_producto,
         regr_slope(unidades_semana, semana_ord) AS pendiente,
         regr_intercept(unidades_semana, semana_ord) AS intercepto,
         COALESCE(regr_r2(unidades_semana, semana_ord), 0) AS r_cuadrado
    FROM serie GROUP BY id_producto
), resumen AS (
  SELECT p."IdProducto" AS id_producto,
         COALESCE(SUM(cf.cantidad) FILTER (WHERE f.fecha_emision >= CURRENT_DATE - INTERVAL '30 days'), 0) AS vendido_30d,
         COALESCE(SUM(cf.cantidad) FILTER (WHERE f.fecha_emision >= CURRENT_DATE - INTERVAL '60 days'), 0) AS vendido_60d,
         COALESCE(SUM(cf.cantidad) FILTER (WHERE f.fecha_emision >= CURRENT_DATE - INTERVAL '90 days'), 0) AS vendido_90d
    FROM producto p
    LEFT JOIN conceptofactura cf ON cf.id_producto = p."IdProducto"
    LEFT JOIN factura f ON f.id_factura = cf.id_factura
      AND f.estatus::text <> 'Cancelada'
      AND COALESCE(f.tipo_comprobante, 'I') = 'I'
    GROUP BY p."IdProducto"
), calculo AS (
  SELECT p.*, r.vendido_30d, r.vendido_60d, r.vendido_90d,
         e.pendiente, e.intercepto, e.r_cuadrado,
         GREATEST(ROUND(
           0.50 * r.vendido_30d
           + 0.30 * (r.vendido_60d / 2.0)
           + 0.20 * (r.vendido_90d / 3.0)
         ), 0) AS pronostico
    FROM producto p
    JOIN resumen r ON r.id_producto = p."IdProducto"
    JOIN estadistica e ON e.id_producto = p."IdProducto"
)
SELECT
  "IdProducto" AS id_producto,
  "Codigo" AS codigo,
  "Descripcion" AS descripcion,
  "Existencia" AS stock_actual,
  "PrecioUnitario" AS precio_unitario,
  vendido_30d, vendido_60d, vendido_90d,
  ROUND(vendido_30d / 30.0, 2) AS prom_diario_30d,
  ROUND(vendido_60d / 60.0, 2) AS prom_diario_60d,
  ROUND(vendido_90d / 90.0, 2) AS prom_diario_90d,
  ROUND(pendiente::numeric, 4) AS pendiente_regresion,
  ROUND(intercepto::numeric, 2) AS intercepto_regresion,
  ROUND(r_cuadrado::numeric, 4) AS r_cuadrado,
  26::bigint AS num_semanas,
  CASE WHEN pendiente > 0.5 THEN 'ALTA'
       WHEN pendiente < -0.5 THEN 'BAJA'
       ELSE 'ESTABLE' END AS tendencia,
  pronostico AS demanda_proyectada_30d,
  GREATEST(pronostico - "Existencia", 0) AS cantidad_sugerida_compra
FROM calculo
ORDER BY cantidad_sugerida_compra DESC, vendido_30d DESC;

CREATE UNIQUE INDEX idx_vw_prediccion_demanda_pk
  ON vw_prediccion_demanda (id_producto);
