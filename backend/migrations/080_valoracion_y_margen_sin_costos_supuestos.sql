-- Costos medios ponderados registrados; desconocidos se conservan NULL.
-- Solo salidas por ajuste/merma; entradas positivas no son pérdidas.
DROP MATERIALIZED VIEW IF EXISTS mv_inventario_almacen;
CREATE MATERIALIZED VIEW mv_inventario_almacen AS
WITH EntradaPromedio AS (
    SELECT id_producto, CASE WHEN bool_and(precio_unitario IS NOT NULL AND precio_unitario>=0)
      THEN sum(cantidad*precio_unitario)/NULLIF(sum(cantidad),0) END as costo_promedio_entrada
    FROM kardex
    WHERE tipo_movimiento = 'COMPRA' AND cantidad>0 AND fecha<=now()
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
        ep.costo_promedio_entrada as costo_unitario_estimado,
        COALESCE(vr.vendidos_90_dias, 0) as vendidos_90_dias,
        COALESCE(vr.facturas_90_dias, 0) as facturas_90_dias,
        (
          SELECT COUNT(*) 
          FROM kardex k 
          WHERE k.id_producto = p."IdProducto" AND k.stock_resultante = 0 AND k.cantidad<0 AND k.fecha >= CURRENT_DATE - INTERVAL '365 days'
        ) as eventos_quiebre_stock,
        (
          SELECT COALESCE(SUM(ABS(k.cantidad) * k.precio_unitario), 0)
          FROM kardex k 
          WHERE k.id_producto = p."IdProducto" AND (k.tipo_movimiento = 'AJUSTE_MANUAL_STOCK' OR k.referencia ILIKE '%merma%') 
          AND k.cantidad<0 AND k.fecha >= CURRENT_DATE - INTERVAL '365 days'
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
    AND k.cantidad<0 AND k.fecha >= CURRENT_DATE - INTERVAL '365 days'
    GROUP BY to_char(k.fecha, 'YYYY-MM')
    ORDER BY mes
)
SELECT 
    1 as id, -- Dummy ID
    CASE WHEN count(*) FILTER(WHERE stock_actual IS NULL OR stock_actual<0 OR (stock_actual>0 AND costo_unitario_estimado IS NULL))=0 THEN COALESCE(SUM(stock_actual * costo_unitario_estimado),0) END as valor_total_inventario,
    SUM(valor_merma_anual) as merma_shrinkage,
    
    -- Estimados Globales Reducidos
    (SUM(vendidos_90_dias * 4) / NULLIF(SUM(stock_actual), 0)) as tasa_rotacion_inventario,
    SUM(eventos_quiebre_stock) as indice_quiebre_stock,
    (SUM(stock_actual) / NULLIF(SUM(vendidos_90_dias) / 90.0, 0)) as dias_inventario,
    
    -- Promedio Costo Aterrizado 
    CASE WHEN count(*) FILTER(WHERE stock_actual IS NULL OR stock_actual<0 OR (stock_actual>0 AND costo_unitario_estimado IS NULL))=0 THEN SUM(stock_actual*costo_unitario_estimado)/NULLIF(SUM(stock_actual),0) END as costo_aterrizado,
    
    -- Sin valoración histórica media fiable no hay un GMROI calculable.
    NULL::numeric as retorno_inversion_inventario,
    
    -- JSON Arrays
    (SELECT COALESCE(json_agg(json_build_object('codigo', codigo, 'descripcion', descripcion, 'dias_sin_ventas', dias_sin_ventas, 'existencia', existencia)), '[]'::json) FROM LentoMovimiento) as mercancia_lento_movimiento,
    (SELECT COALESCE(json_agg(json_build_object('mes', mes, 'valor', valor)), '[]'::json) FROM ShrinkageMensual) as shrinkage_historico_json

FROM ProductoStats;

CREATE UNIQUE INDEX idx_mv_inventario_almacen ON mv_inventario_almacen(id);

-- Márgenes netos después de devoluciones/notas con costo congelado en la venta.
DROP MATERIALIZED VIEW IF EXISTS mv_ventas_facturacion;
CREATE MATERIALIZED VIEW mv_ventas_facturacion AS
WITH margenes AS (SELECT * FROM fn_get_margen_productos()), resumen AS (
  SELECT COALESCE(sum(ingresos_totales),0) AS ingresos,
    CASE WHEN COALESCE(bool_and(costo_conocido),true) THEN COALESCE(sum(costo_total),0) END AS costo
  FROM margenes
), facturas AS (
  SELECT * FROM factura WHERE estatus::text<>'Cancelada' AND COALESCE(tipo_comprobante,'I')='I'
), categorias AS (
  SELECT c."Descripcion" AS categoria,sum(m.ingresos_totales) AS ventas
  FROM margenes m JOIN producto p ON p."IdProducto"=m.id_producto
  JOIN categoria c ON c."IdCategoria"=p."IdCategoria" GROUP BY c."Descripcion"
), actividad AS (
  SELECT EXTRACT(DOW FROM fecha_emision) AS dia,EXTRACT(HOUR FROM fecha_emision) AS hora,
    sum(total) AS ventas FROM facturas GROUP BY 1,2
)
SELECT 1 AS id,
  (SELECT COALESCE(sum(subtotal),0) FROM facturas) AS ingresos_brutos,
  r.ingresos AS ingresos_netos,
  (SELECT avg(total) FROM facturas) AS ticket_promedio,
  100.0*(r.ingresos-r.costo)/NULLIF(r.ingresos,0) AS margen_utilidad_bruta,
  (SELECT 100.0*sum(descuento)/NULLIF(sum(subtotal),0) FROM facturas) AS descuento_promedio_otorgado,
  (SELECT COALESCE(json_agg(json_build_object('categoria',categoria,'ventas',ventas) ORDER BY categoria),'[]'::json)
    FROM categorias) AS ventas_por_categoria,
  (SELECT COALESCE(json_agg(json_build_object('dia',dia,'hora',hora,'ventas',ventas) ORDER BY dia,hora),'[]'::json)
    FROM actividad) AS comportamiento_hora_dia
FROM resumen r;
CREATE UNIQUE INDEX idx_mv_ventas_facturacion ON mv_ventas_facturacion(id);


