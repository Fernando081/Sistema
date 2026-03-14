-- 1. Fix the cancellation stored procedure with correct ENUM and reset commission
CREATE OR REPLACE PROCEDURE public.sp_cancelar_factura(IN p_id_venta integer)
 LANGUAGE plpgsql
AS $procedure$
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

    -- 2. Cambiar estatus de la factura, resetear saldo y resetear comisión a 0
    UPDATE factura 
    SET estatus = 'Cancelada'::estatus_factura_enum, 
        saldo_pendiente = 0,
        comision_vendedor = 0 
    WHERE id_factura = p_id_venta;

    -- 3. Restaurar stock e insertar en Kardex
    FOR v_item IN (SELECT id_producto, cantidad, valor_unitario FROM conceptofactura WHERE id_factura = p_id_venta) LOOP
        -- Actualizar Existencia en producto
        UPDATE producto SET "Existencia" = "Existencia" + v_item.cantidad WHERE "IdProducto" = v_item.id_producto;
        
        -- Insertar movimiento en kardex (ENTRADA POR DEVOLUCION)
        -- FIXED CAST ERROR 42704: tipo_movimiento_kardex_enum -> tipo_movimiento_enum
        INSERT INTO kardex (
            id_producto, fecha, tipo_movimiento, cantidad,
            stock_anterior, stock_resultante, precio_unitario, referencia, id_referencia
        ) VALUES (
            v_item.id_producto, NOW(), 'ENTRADA POR DEVOLUCION'::tipo_movimiento_enum, v_item.cantidad,
            (SELECT "Existencia" - v_item.cantidad FROM producto WHERE "IdProducto" = v_item.id_producto), 
            (SELECT "Existencia" FROM producto WHERE "IdProducto" = v_item.id_producto), 
            v_item.valor_unitario, 'Cancelación de Factura', p_id_venta
        );
    END LOOP;

    -- 4. Invalidar pagos relacionados
    -- This will trigger "trg_sync_reverso_saldos" to deduct the money
    DELETE FROM pago WHERE id_factura = p_id_venta;
END;
$procedure$;

-- 2. Create the AFTER DELETE trigger to revert balances securely
CREATE OR REPLACE FUNCTION fn_sync_reverso_saldos()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.forma_pago ILIKE '%Efectivo%' THEN
        UPDATE saldos SET caja_chica = caja_chica - OLD.monto, updated_at = NOW();
    ELSE
        UPDATE saldos SET cuenta_banco = cuenta_banco - OLD.monto, updated_at = NOW();
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_reverso_saldos ON pago;
CREATE TRIGGER trg_sync_reverso_saldos
AFTER DELETE ON pago
FOR EACH ROW
EXECUTE FUNCTION fn_sync_reverso_saldos();
