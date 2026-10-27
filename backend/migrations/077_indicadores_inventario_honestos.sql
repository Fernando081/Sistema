-- Días reales desde última venta; sin ventas previas = NULL.
-- Retira GMROI ficticio; cálculo histórico completo pendiente (Q02).
DROP MATERIALIZED VIEW IF EXISTS mv_inventario_almacen;
CREATE MATERIALIZED VIEW mv_inventario_almacen AS
WITH EntradaPromedio AS (
    SELECT id_producto, AVG(precio_unitario) as costo_promedio_entrada
    FROM kardex
    WHERE tipo_movimiento = 'COMPRA'
    GROUP BY id_producto
),
VentasRecientes AS (
    SELECT id_producto, SUM(cantidad) as vendidos_90_dias, COUNT(DISTINCT f.id_factura) as facturas_90_dias
    FROM conceptofactura cf
    JOIN factura f ON cf.id_factura = f.id_factura
    WHERE f.fecha_emision >= CURRENT_DATE - INTERVAL '90 days' AND f.estatus IN ('Timbrada', 'Pagada')
      AND COALESCE(f.tipo_comprobante, 'I') = 'I'
    GROUP BY id_producto
),
ProductoStats AS (
    SELECT 
        p."IdProducto" as id_producto,
        p."Codigo" as codigo_producto,
        p."Descripcion" as descripcion_producto,
        p."Existencia" as stock_actual,
        COALESCE(ep.costo_promedio_entrada, p."PrecioUnitario" * 0.6) as costo_unitario_estimado,
        COALESCE(vr.vendidos_90_dias, 0) as vendidos_90_dias,
        COALESCE(vr.facturas_90_dias, 0) as facturas_90_dias,
        (
          SELECT COUNT(*) 
          FROM kardex k 
          WHERE k.id_producto = p."IdProducto" AND k.stock_resultante = 0 AND k.fecha >= CURRENT_DATE - INTERVAL '365 days'
        ) as eventos_quiebre_stock,
        (
          SELECT COALESCE(SUM(ABS(k.cantidad) * k.precio_unitario), 0)
          FROM kardex k 
          WHERE k.id_producto = p."IdProducto" AND (k.tipo_movimiento = 'AJUSTE_MANUAL_STOCK' OR k.referencia ILIKE '%merma%') 
          AND k.fecha >= CURRENT_DATE - INTERVAL '365 days'
        ) as valor_merma_anual
    FROM producto p
    LEFT JOIN EntradaPromedio ep ON p."IdProducto" = ep.id_producto
    LEFT JOIN VentasRecientes vr ON p."IdProducto" = vr.id_producto
),
UltimaVenta AS (
    SELECT cf.id_producto, MAX(f.fecha_emision::date) AS ultima_venta
    FROM conceptofactura cf JOIN factura f ON f.id_factura = cf.id_factura
    WHERE f.estatus IN ('Timbrada', 'Pagada')
      AND COALESCE(f.tipo_comprobante, 'I') = 'I'
    GROUP BY cf.id_producto
),
LentoMovimiento AS (
    SELECT 
        codigo_producto as codigo,
        descripcion_producto as descripcion,
        CASE WHEN uv.ultima_venta IS NOT NULL THEN CURRENT_DATE - uv.ultima_venta END as dias_sin_ventas,
        stock_actual as existencia
    FROM ProductoStats ps
    LEFT JOIN UltimaVenta uv ON uv.id_producto = ps.id_producto
    WHERE facturas_90_dias = 0 AND stock_actual > 0
),
ShrinkageMensual AS (
    SELECT 
        to_char(k.fecha, 'YYYY-MM') as mes,
        SUM(ABS(k.cantidad) * k.precio_unitario) as valor
    FROM kardex k 
    WHERE (k.tipo_movimiento = 'AJUSTE_MANUAL_STOCK' OR k.referencia ILIKE '%merma%') 
    AND k.fecha >= CURRENT_DATE - INTERVAL '365 days'
    GROUP BY to_char(k.fecha, 'YYYY-MM')
    ORDER BY mes
)
SELECT 
    1 as id, -- Dummy ID
    SUM(stock_actual * costo_unitario_estimado) as valor_total_inventario,
    SUM(valor_merma_anual) as merma_shrinkage,
    
    -- Estimados Globales Reducidos
    (SUM(vendidos_90_dias * 4) / NULLIF(SUM(stock_actual), 0)) as tasa_rotacion_inventario,
    SUM(eventos_quiebre_stock) as indice_quiebre_stock,
    (SUM(stock_actual) / NULLIF(SUM(vendidos_90_dias) / 90.0, 0)) as dias_inventario,
    
    -- Promedio Costo Aterrizado 
    AVG(costo_unitario_estimado) as costo_aterrizado,
    
    -- Sin valoración histórica media fiable no hay un GMROI calculable.
    NULL::numeric as retorno_inversion_inventario,
    
    -- JSON Arrays
    (SELECT COALESCE(json_agg(json_build_object('codigo', codigo, 'descripcion', descripcion, 'dias_sin_ventas', dias_sin_ventas, 'existencia', existencia)), '[]'::json) FROM LentoMovimiento) as mercancia_lento_movimiento,
    (SELECT COALESCE(json_agg(json_build_object('mes', mes, 'valor', valor)), '[]'::json) FROM ShrinkageMensual) as shrinkage_historico_json

FROM ProductoStats;

CREATE UNIQUE INDEX idx_mv_inventario_almacen ON mv_inventario_almacen(id);


