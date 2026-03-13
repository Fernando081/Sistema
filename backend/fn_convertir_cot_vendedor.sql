DROP FUNCTION IF EXISTS public.fn_convertir_cotizacion_a_venta(integer, integer, integer);

CREATE OR REPLACE FUNCTION public.fn_convertir_cotizacion_a_venta(p_id_cotizacion integer, p_id_forma_pago integer, p_id_metodo_pago integer, p_id_vendedor integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
    r_cot record;
    v_conceptos_json JSONB;
    v_id_factura INT;
    
    -- Variable para guardar el producto que falle
    v_prod_insuficiente record; 
BEGIN
    -- 1. Obtener datos de la cotización
    SELECT * INTO r_cot FROM cotizacion WHERE id_cotizacion = p_id_cotizacion;

    IF r_cot.estatus = 'Convertida' THEN
        RAISE EXCEPTION 'Esta cotización ya fue convertida anteriormente.';
    END IF;

    -- [NUEVA VALIDACIÓN] Verificar Stock antes de proceder
    SELECT p."Descripcion", p."Existencia", cc.cantidad
    INTO v_prod_insuficiente
    FROM conceptocotizacion cc
    JOIN producto p ON cc.id_producto = p."IdProducto"
    WHERE cc.id_cotizacion = p_id_cotizacion
    AND p."Existencia" < cc.cantidad -- Aquí detectamos si falta stock
    LIMIT 1;

    -- Si encontramos un producto insuficiente, lanzamos el error AHORA
    IF v_prod_insuficiente IS NOT NULL THEN
        RAISE EXCEPTION 'Stock insuficiente: El producto "%" solo tiene % existencias y necesitas %.', 
            v_prod_insuficiente."Descripcion", 
            v_prod_insuficiente."Existencia", 
            v_prod_insuficiente.cantidad;
    END IF;
    -- [FIN NUEVA VALIDACIÓN]

    -- 2. Construir el JSON de productos
    SELECT jsonb_agg(jsonb_build_object(
        'idProducto', cc.id_producto,
        'cantidad', cc.cantidad,
        'valorUnitario', cc.valor_unitario,
        'importe', cc.importe,
        'descuento', 0,
        'claveProdServ', cps."Clave",
        'claveUnidad', cu."Clave",
        'objetoImpuesto', p."ObjetoImpuesto",
        'descripcion', cc.descripcion,
        'unidadDescripcion', cc.unidad,
        'baseIva', cc.importe,
        'tasaIva', p."TasaIVA",
        'importeIva', cc.importe_iva,
        'baseRetIsr', cc.importe,
        'tasaRetIsr', CASE WHEN cc.importe_ret_isr > 0 THEN 0.0125 ELSE 0 END,
        'importeRetIsr', cc.importe_ret_isr
    )) INTO v_conceptos_json
    FROM conceptocotizacion cc
    JOIN producto p ON cc.id_producto = p."IdProducto"
    LEFT JOIN claveproductooservicio cps ON p."IdClaveProdOServ" = cps."IdClaveProdOServ"
    LEFT JOIN claveunidad cu ON p."IdClaveUnidad" = cu."IdClaveUnidad"
    WHERE cc.id_cotizacion = p_id_cotizacion;

    -- 3. Llamar a la función de venta, pasando p_id_vendedor como parámetro #17
    SELECT fn_crear_venta(
        r_cot.id_cliente,
        r_cot.rfc_receptor,
        r_cot.nombre_receptor,
        '00000', '616', 'G03', p_id_forma_pago, p_id_metodo_pago, 'MXN', 1,
        r_cot.subtotal,
        r_cot.total_impuestos,
        r_cot.total_retenciones,
        r_cot.total,
        'Venta generada desde Cotización C-' || r_cot.folio,
        v_conceptos_json,
        p_id_vendedor
    ) INTO v_id_factura;

    -- 4. Actualizar estatus
    UPDATE cotizacion SET estatus = 'Convertida' WHERE id_cotizacion = p_id_cotizacion;

    RETURN v_id_factura;
END;
$function$;
