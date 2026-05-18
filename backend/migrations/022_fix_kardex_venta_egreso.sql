CREATE OR REPLACE FUNCTION public.fn_kardex_venta()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_stock_actual numeric;
    v_folio_factura varchar;
    v_tipo_comprobante char(1);
    v_multiplicador int;
    v_tipo_movimiento varchar;
    v_referencia varchar;
BEGIN
    -- 1. Obtener Stock actual (Usamos "Existencia" y "IdProducto")
    SELECT "Existencia" INTO v_stock_actual 
    FROM producto 
    WHERE "IdProducto" = NEW.id_producto;

    -- 2. Obtener Folio y Tipo de Comprobante
    SELECT CONCAT(serie, '-', folio), tipo_comprobante INTO v_folio_factura, v_tipo_comprobante
    FROM factura 
    WHERE id_factura = NEW.id_factura;

    -- 3. Determinar si es Ingreso (Venta) o Egreso (Devolución)
    IF v_tipo_comprobante = 'E' THEN
        v_multiplicador := 1;
        v_tipo_movimiento := 'ENTRADA POR DEVOLUCION';
        v_referencia := CONCAT('Devolución/Egreso: ', v_folio_factura);
    ELSE
        v_multiplicador := -1;
        v_tipo_movimiento := 'VENTA';
        v_referencia := CONCAT('Venta Factura: ', v_folio_factura);
    END IF;

    -- 4. Insertar en Kardex
    INSERT INTO kardex (
        id_producto, 
        tipo_movimiento, 
        cantidad, 
        stock_anterior, 
        stock_resultante, 
        precio_unitario, 
        referencia, 
        id_referencia
    ) VALUES (
        NEW.id_producto,
        v_tipo_movimiento::tipo_movimiento_enum,
        NEW.cantidad * v_multiplicador,
        v_stock_actual,
        v_stock_actual + (NEW.cantidad * v_multiplicador),
        NEW.valor_unitario,
        v_referencia,
        NEW.id_factura
    );

    -- 5. Actualizar Inventario (Suma o Resta según multiplicador)
    UPDATE producto 
    SET "Existencia" = "Existencia" + (NEW.cantidad * v_multiplicador) 
    WHERE "IdProducto" = NEW.id_producto;

    RETURN NEW;
END;
$function$;
