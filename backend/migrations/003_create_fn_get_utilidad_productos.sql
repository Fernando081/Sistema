-- backend/migrations/003_create_fn_get_utilidad_productos.sql

CREATE OR REPLACE FUNCTION fn_get_utilidad_productos()
RETURNS TABLE (
    id_producto INT,
    codigo VARCHAR,
    descripcion VARCHAR,
    cantidad_vendida NUMERIC,
    ingresos_totales NUMERIC,
    costo_total NUMERIC,
    utilidad_neta NUMERIC,
    margen_porcentaje NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    WITH ventas_cte AS (
        -- Suma de las cantidades e importes vendidos por cada producto, 
        -- considerando solo facturas que no estén canceladas. 
        SELECT 
            cf.id_producto as prod_id,
            SUM(cf.cantidad) AS cant_vendida,
            SUM(cf.importe) AS total_ingresos
        FROM conceptofactura cf
        JOIN factura f ON cf.id_factura = f.id_factura
        WHERE f.estatus != 'Cancelada'
        GROUP BY cf.id_producto
    ),
    costos_cte AS (
        -- Costo promedio histórico por producto (en base a las compras registradas)
        SELECT 
            dc.id_producto AS prod_id,
            CASE 
                WHEN SUM(dc.cantidad) > 0 THEN SUM(dc.importe) / SUM(dc.cantidad)
                ELSE 0
            END AS costo_unitario_promedio
        FROM detalle_compra dc
        JOIN compra c ON dc.id_compra = c.id_compra
        WHERE c.estatus != 'Cancelada' AND c.estatus != 'Cancelado'
        GROUP BY dc.id_producto
    )
    SELECT 
        p."IdProducto" as id_producto,
        p."Codigo" as codigo,
        p."Descripcion" as descripcion,
        COALESCE(v.cant_vendida, 0) AS cantidad_vendida,
        COALESCE(v.total_ingresos, 0) AS ingresos_totales,
        -- El costo total es la cantidad vendida por el costo unitario promedio, o por el precio unitario del catálogo si no hay compras
        (COALESCE(v.cant_vendida, 0) * COALESCE(c.costo_unitario_promedio, p."PrecioUnitario" * 0.5)) AS costo_total, -- Asumiendo 50% de margen si no hay historial de compras, para no dejar 0
        -- Utilidad = Ingresos - Costos
        (COALESCE(v.total_ingresos, 0) - (COALESCE(v.cant_vendida, 0) * COALESCE(c.costo_unitario_promedio, p."PrecioUnitario" * 0.5))) AS utilidad_neta,
        -- Margen % = (Utilidad / Ingresos) * 100
        CASE 
            WHEN COALESCE(v.total_ingresos, 0) > 0 
            THEN ((COALESCE(v.total_ingresos, 0) - (COALESCE(v.cant_vendida, 0) * COALESCE(c.costo_unitario_promedio, p."PrecioUnitario" * 0.5))) / v.total_ingresos) * 100
            ELSE 0 
        END AS margen_porcentaje
    FROM producto p
    JOIN ventas_cte v ON p."IdProducto" = v.prod_id
    LEFT JOIN costos_cte c ON p."IdProducto" = c.prod_id
    ORDER BY utilidad_neta DESC;
END;
$$ LANGUAGE plpgsql;
