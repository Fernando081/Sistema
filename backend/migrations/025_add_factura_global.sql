-- Migración 025: Soporte para Factura Global CFDI 4.0

-- 1. Agregar columna de relación para agrupar tickets
ALTER TABLE factura ADD COLUMN IF NOT EXISTS id_factura_global INT NULL REFERENCES factura(id_factura);

-- 2. Insertar cliente genérico PUBLICO EN GENERAL
-- Usamos IdRegimenFiscal = 12 (Clave 616 - Sin obligaciones fiscales)
-- Usamos IdUsoCFDI = 22 (Clave S01 - Sin efectos fiscales)
-- Usamos IdFormaPago = 1 (Clave 01 - Efectivo)
-- Usamos IdMetodoDePago = 1 (Clave PUE)
-- Usamos el código postal emisor de la empresa: 89318
INSERT INTO cliente (
  "RFC", "RazonSocial", "Pais", "IdEstado", "IdMunicipio", 
  "Ciudad", "Colonia", "Calle", "CodigoPostal", 
  "NumeroExterior", "NumeroInterior", "Referencia", 
  "IdMetodoDePago", "IdUsoCFDI", "IdFormaPago", "IdRegimenFiscal", 
  "saldo_a_favor"
)
VALUES (
  'XAXX010101000', 
  'PUBLICO EN GENERAL', 
  'México', 
  9, 
  286, 
  'ALVARO OBREGON', 
  'OLIVAR DE LOS PADRES', 
  'LOMAS TINAJAS', 
  '89318', 
  '35', 
  '', 
  '', 
  1, 
  22, 
  1, 
  12, 
  0.00
) ON CONFLICT ("RFC") DO NOTHING;

-- 3. Actualizar fn_kardex_venta para omitir conceptos sin producto (conceptos de facturación global)
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
    -- Si no hay id_producto (conceptos de Factura Global), omitir actualizaciones
    IF NEW.id_producto IS NULL THEN
        RETURN NEW;
    END IF;

    -- 1. Obtener Stock actual
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

    -- 5. Actualizar Inventario
    UPDATE producto 
    SET "Existencia" = "Existencia" + (NEW.cantidad * v_multiplicador) 
    WHERE "IdProducto" = NEW.id_producto;

    RETURN NEW;
END;
$function$;

-- 4. Actualizar sp_cancelar_factura para omitir conceptos sin producto y desvincular tickets globales
CREATE OR REPLACE PROCEDURE sp_cancelar_factura(p_id_venta INT)
LANGUAGE plpgsql
AS $$
DECLARE
    v_estatus VARCHAR;
    v_item RECORD;
BEGIN
    -- 1. Verificar existencia y estatus no cancelado
    SELECT estatus::varchar INTO v_estatus FROM factura WHERE id_factura = p_id_venta;
    IF v_estatus IS NULL THEN
        RAISE EXCEPTION 'Factura no encontrada';
    END IF;
    IF v_estatus = 'Cancelada' THEN
        RAISE EXCEPTION 'La factura ya se encuentra cancelada';
    END IF;

    -- 2. Cambiar estatus de la factura
    UPDATE factura SET estatus = 'Cancelada'::estatus_factura_enum, saldo_pendiente = 0 WHERE id_factura = p_id_venta;

    -- 3. Restaurar stock e insertar en Kardex (solo para conceptos con producto)
    FOR v_item IN (SELECT id_producto, cantidad, valor_unitario FROM conceptofactura WHERE id_factura = p_id_venta) LOOP
        IF v_item.id_producto IS NOT NULL THEN
            -- Actualizar Existencia en producto
            UPDATE producto SET "Existencia" = "Existencia" + v_item.cantidad WHERE "IdProducto" = v_item.id_producto;
            
            -- Insertar movimiento en kardex
            INSERT INTO kardex (
                id_producto, fecha, tipo_movimiento, cantidad,
                stock_anterior, stock_resultante, precio_unitario, referencia, id_referencia
            ) VALUES (
                v_item.id_producto, NOW(), 'ENTRADA POR DEVOLUCION'::tipo_movimiento_kardex_enum, v_item.cantidad,
                (SELECT "Existencia" - v_item.cantidad FROM producto WHERE "IdProducto" = v_item.id_producto), 
                (SELECT "Existencia" FROM producto WHERE "IdProducto" = v_item.id_producto), 
                v_item.valor_unitario, 'Cancelación de Factura', p_id_venta
            );
        END IF;
    END LOOP;

    -- 4. Invalidar pagos relacionados
    DELETE FROM pago WHERE id_factura = p_id_venta;

    -- 5. Desvincular tickets si esta era una Factura Global
    UPDATE factura SET id_factura_global = NULL WHERE id_factura_global = p_id_venta;
END;
$$;
