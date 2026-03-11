-- =============================================================
-- Migration 020: Predictive Demand View (AI Smart Restock)
-- Uses PostgreSQL regr_slope / regr_intercept for linear regression
-- and moving averages to predict next-month demand per product.
-- =============================================================

DROP MATERIALIZED VIEW IF EXISTS vw_prediccion_demanda;

CREATE MATERIALIZED VIEW vw_prediccion_demanda AS
WITH
  -- 1. Aggregate daily sales per product for the last 180 days
  ventas_diarias AS (
    SELECT
      cf.id_producto,
      DATE(f.fecha_emision) AS dia,
      SUM(cf.cantidad)       AS unidades
    FROM conceptofactura cf
    JOIN factura f ON cf.id_factura = f.id_factura
    WHERE f.estatus != 'Cancelada'::estatus_factura_enum
      AND f.fecha_emision >= NOW() - INTERVAL '180 days'
    GROUP BY cf.id_producto, DATE(f.fecha_emision)
  ),

  -- 2. Moving averages: 30d, 60d, 90d
  promedios AS (
    SELECT
      p."IdProducto" AS id_producto,
      COALESCE(SUM(vd.unidades) FILTER (WHERE vd.dia >= NOW() - INTERVAL '30 days'), 0)  AS vendido_30d,
      COALESCE(SUM(vd.unidades) FILTER (WHERE vd.dia >= NOW() - INTERVAL '60 days'), 0)  AS vendido_60d,
      COALESCE(SUM(vd.unidades) FILTER (WHERE vd.dia >= NOW() - INTERVAL '90 days'), 0)  AS vendido_90d,
      -- Daily averages (avoid division by zero)
      ROUND(COALESCE(SUM(vd.unidades) FILTER (WHERE vd.dia >= NOW() - INTERVAL '30 days'), 0) / 30.0, 2) AS prom_diario_30d,
      ROUND(COALESCE(SUM(vd.unidades) FILTER (WHERE vd.dia >= NOW() - INTERVAL '60 days'), 0) / 60.0, 2) AS prom_diario_60d,
      ROUND(COALESCE(SUM(vd.unidades) FILTER (WHERE vd.dia >= NOW() - INTERVAL '90 days'), 0) / 90.0, 2) AS prom_diario_90d
    FROM producto p
    LEFT JOIN ventas_diarias vd ON p."IdProducto" = vd.id_producto
    GROUP BY p."IdProducto"
  ),

  -- 3. Weekly buckets for regression (x = week number, y = units sold)
  ventas_semanales AS (
    SELECT
      id_producto,
      -- x axis: week ordinal (1 = oldest week, N = newest)
      RANK() OVER (PARTITION BY id_producto ORDER BY DATE_TRUNC('week', dia)) AS semana_ord,
      SUM(unidades) AS unidades_semana
    FROM ventas_diarias
    GROUP BY id_producto, DATE_TRUNC('week', dia)
  ),

  -- 4. Linear Regression per product
  regresion AS (
    SELECT
      id_producto,
      COUNT(*)                                              AS num_semanas,
      COALESCE(REGR_SLOPE(unidades_semana, semana_ord), 0)     AS pendiente,
      COALESCE(REGR_INTERCEPT(unidades_semana, semana_ord), 0) AS intercepto,
      COALESCE(REGR_R2(unidades_semana, semana_ord), 0)        AS r_cuadrado
    FROM ventas_semanales
    GROUP BY id_producto
  )

-- 5. Final SELECT: join everything and compute predictions
SELECT
  p."IdProducto"     AS id_producto,
  p."Codigo"         AS codigo,
  p."Descripcion"    AS descripcion,
  p."Existencia"     AS stock_actual,
  p."PrecioUnitario" AS precio_unitario,

  -- Moving averages
  pm.vendido_30d,
  pm.vendido_60d,
  pm.vendido_90d,
  pm.prom_diario_30d,
  pm.prom_diario_60d,
  pm.prom_diario_90d,

  -- Regression stats
  ROUND(r.pendiente::numeric, 4)   AS pendiente_regresion,
  ROUND(r.intercepto::numeric, 2)  AS intercepto_regresion,
  ROUND(r.r_cuadrado::numeric, 4)  AS r_cuadrado,
  r.num_semanas,

  -- Trend classification based on slope
  CASE
    WHEN r.pendiente >  0.5 THEN 'ALTA'
    WHEN r.pendiente < -0.5 THEN 'BAJA'
    ELSE 'ESTABLE'
  END AS tendencia,

  -- Projected demand for next 30 days
  -- Uses the regression line: y = intercepto + pendiente * (num_semanas + 4.3)
  -- 4.3 weeks ≈ 30 days projected forward
  GREATEST(
    ROUND((r.intercepto + r.pendiente * (r.num_semanas + 4.3))::numeric, 0),
    0
  ) AS demanda_proyectada_30d,

  -- Suggested purchase quantity = projected demand - current stock (floor at 0)
  GREATEST(
    ROUND((r.intercepto + r.pendiente * (r.num_semanas + 4.3))::numeric, 0) - p."Existencia",
    0
  ) AS cantidad_sugerida_compra

FROM producto p
LEFT JOIN promedios pm ON p."IdProducto" = pm.id_producto
LEFT JOIN regresion r  ON p."IdProducto" = r.id_producto
ORDER BY cantidad_sugerida_compra DESC, pm.vendido_30d DESC;

-- Index for fast refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_vw_prediccion_demanda_pk
  ON vw_prediccion_demanda (id_producto);

-- Helper: refresh command (can be called via cron or NestJS scheduler)
-- REFRESH MATERIALIZED VIEW CONCURRENTLY vw_prediccion_demanda;
