CREATE OR REPLACE VIEW vw_smart_restock AS
WITH ventas_30d AS (
    SELECT 
        cf.id_producto,
        SUM(cf.cantidad) as unidades_vendidas_30d
    FROM conceptofactura cf
    JOIN factura f ON cf.id_factura = f.id_factura
    WHERE f.estatus != 'Cancelada'::estatus_factura_enum 
      AND f.fecha_emision >= NOW() - INTERVAL '30 days'
    GROUP BY cf.id_producto
)
SELECT 
    p."IdProducto" as id_producto,
    p."Codigo" as codigo,
    p."Descripcion" as descripcion,
    COALESCE(v.unidades_vendidas_30d, 0) as unidades_vendidas_30d,
    p."Existencia" as stock_actual,
    p."PrecioUnitario" as precio_unitario,
    COALESCE((SELECT margen_porcentaje FROM public.fn_get_utilidad_productos() u WHERE u.id_producto = p."IdProducto" LIMIT 1), 0) as margen
FROM producto p
LEFT JOIN ventas_30d v ON p."IdProducto" = v.id_producto
ORDER BY unidades_vendidas_30d DESC, margen DESC;
