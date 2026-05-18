-- Migración 023: Arreglar métricas y comisiones para ignorar Egresos y Canceladas

-- 1. Actualizar comisiones para ignorar Egresos
CREATE OR REPLACE FUNCTION public.fn_get_comisiones_semanales()
 RETURNS TABLE(semana text, id_vendedor integer, vendedor_nombre character varying, ventas_realizadas bigint, total_ventas_brutas numeric, comisiones_acumuladas numeric)
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        to_char(f.fecha_emision, 'IYYY-"W"IW') AS semana,
        f.id_vendedor,
        u.username AS vendedor_nombre,
        COUNT(f.id_factura) AS ventas_realizadas,
        SUM(f.subtotal) AS total_ventas_brutas,
        SUM(f.comision_vendedor) AS comisiones_acumuladas
    FROM 
        factura f
    JOIN 
        auth_user u ON f.id_vendedor = u.id_user
    WHERE 
        f.id_vendedor IS NOT NULL
        AND f.estatus != 'Cancelada'::estatus_factura_enum
        AND f.tipo_comprobante = 'I'  -- IMPORTANTE: Solo Ingresos
    GROUP BY 
        semana, f.id_vendedor, vendedor_nombre
    ORDER BY 
        semana DESC, vendedor_nombre ASC;
END;
$function$;

-- 2. Actualizar Dashboard Metrics
CREATE OR REPLACE FUNCTION public.fn_get_dashboard_metrics()
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_ventas_hoy NUMERIC;
    v_ventas_mes NUMERIC;
    v_por_cobrar NUMERIC;
    v_por_pagar NUMERIC;
    v_conteo_bajos INT;
    v_lista_bajos JSONB;
    v_grafica JSONB;
    v_top_productos JSONB;
    
    -- Variable auxiliar para saber qué día es HOY en México
    v_fecha_actual_mx DATE;
BEGIN
    -- 1. Calculamos la fecha actual en México (Tampico/CDMX)
    v_fecha_actual_mx := (NOW() AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City')::date;

    -- 2. Ventas de HOY (Solo Ingresos y No Canceladas)
    SELECT COALESCE(SUM(total), 0) INTO v_ventas_hoy 
    FROM factura 
    WHERE (fecha_emision AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City')::date = v_fecha_actual_mx
      AND tipo_comprobante = 'I'
      AND estatus != 'Cancelada'::estatus_factura_enum;

    -- 3. Ventas del MES (Solo Ingresos y No Canceladas)
    SELECT COALESCE(SUM(total), 0) INTO v_ventas_mes 
    FROM factura 
    WHERE date_part('month', fecha_emision AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City') = date_part('month', v_fecha_actual_mx)
      AND date_part('year', fecha_emision AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City') = date_part('year', v_fecha_actual_mx)
      AND tipo_comprobante = 'I'
      AND estatus != 'Cancelada'::estatus_factura_enum;

    -- 4. Cuentas por Cobrar (Clientes me deben)
    -- NOTA: Las Notas de Crédito (Egresos) ya restan del saldo a favor o de la deuda en otras lógicas,
    -- pero para "facturas que me deben", contamos solo los Ingresos que no han sido pagados
    SELECT COALESCE(SUM(saldo_pendiente), 0) INTO v_por_cobrar 
    FROM factura 
    WHERE (estatus = 'Pendiente' OR saldo_pendiente > 0.01)
      AND tipo_comprobante = 'I';

    -- 5. Cuentas por Pagar (Debo a proveedores)
    SELECT COALESCE(SUM(saldo_pendiente), 0) INTO v_por_pagar 
    FROM compra 
    WHERE estatus = 'Pendiente' OR saldo_pendiente > 0.01;

    -- 6. Productos Bajos en Stock
    SELECT COUNT(*) INTO v_conteo_bajos FROM producto WHERE "Existencia" <= 10;

    SELECT jsonb_agg(t) INTO v_lista_bajos FROM (
        SELECT "Codigo" as codigo, "Descripcion" as descripcion, "Existencia" as existencia
        FROM producto WHERE "Existencia" <= 10 
        ORDER BY "Existencia" ASC 
        LIMIT 5
    ) t;

    -- 7. Gráfica Histórica (Últimos 7 días) - Solo Ingresos y No Canceladas
    SELECT jsonb_agg(t) INTO v_grafica FROM (
        SELECT 
            TO_CHAR(fecha_emision AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City', 'DD/MM') as name, 
            SUM(total) as value
        FROM factura
        WHERE fecha_emision >= NOW() - INTERVAL '7 days'
          AND tipo_comprobante = 'I'
          AND estatus != 'Cancelada'::estatus_factura_enum
        GROUP BY 1, date(fecha_emision AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City')
        ORDER BY date(fecha_emision AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City') ASC
    ) t;

    -- 8. Top 5 Productos más vendidos - Solo Ingresos y No Canceladas
    SELECT jsonb_agg(t) INTO v_top_productos FROM (
        SELECT 
            LEFT(p."Descripcion", 15) as name,
            SUM(d.cantidad) as value
        FROM conceptofactura d
        JOIN factura f ON d.id_factura = f.id_factura
        JOIN producto p ON d.id_producto = p."IdProducto"
        WHERE f.tipo_comprobante = 'I' 
          AND f.estatus != 'Cancelada'::estatus_factura_enum
        GROUP BY p."Descripcion"
        ORDER BY value DESC
        LIMIT 5
    ) t;

    -- 9. Retorno Final
    RETURN jsonb_build_object(
        'ventasHoy', v_ventas_hoy,
        'ventasMes', v_ventas_mes,
        'porCobrar', v_por_cobrar,
        'porPagar', v_por_pagar,
        'conteoBajos', v_conteo_bajos,
        'grafica', COALESCE(v_grafica, '[]'::jsonb),
        'listaBajos', COALESCE(v_lista_bajos, '[]'::jsonb),
        'topProductos', COALESCE(v_top_productos, '[]'::jsonb)
    );
END;
$function$;
