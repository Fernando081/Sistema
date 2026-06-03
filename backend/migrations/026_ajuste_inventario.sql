-- Migración 026: Ajuste Manual de Inventario

-- 1. Crear el procedimiento almacenado para realizar el ajuste de inventario
CREATE OR REPLACE PROCEDURE sp_ajustar_inventario(
    p_id_producto INT,
    p_cantidad NUMERIC,
    p_tipo VARCHAR,
    p_motivo VARCHAR
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_existencia_actual NUMERIC;
    v_stock_resultante NUMERIC;
    v_kardex_cantidad NUMERIC;
    v_precio_unitario NUMERIC;
BEGIN
    -- 1. Validaciones básicas
    IF p_cantidad <= 0 THEN
        RAISE EXCEPTION 'La cantidad a ajustar debe ser mayor a cero.';
    END IF;

    IF p_tipo NOT IN ('ENTRADA POR AJUSTE', 'SALIDA POR MERMA/AJUSTE') THEN
        RAISE EXCEPTION 'El tipo de movimiento debe ser ENTRADA POR AJUSTE o SALIDA POR MERMA/AJUSTE.';
    END IF;

    IF p_motivo IS NULL OR TRIM(p_motivo) = '' THEN
        RAISE EXCEPTION 'El motivo del ajuste es obligatorio.';
    END IF;

    -- 2. Verificar existencia del producto
    SELECT "Existencia", "PrecioUnitario" INTO v_existencia_actual, v_precio_unitario
    FROM producto
    WHERE "IdProducto" = p_id_producto;

    IF v_existencia_actual IS NULL THEN
        RAISE EXCEPTION 'Producto no encontrado.';
    END IF;

    -- 3. Calcular cantidades y nuevo stock
    IF p_tipo = 'ENTRADA POR AJUSTE' THEN
        v_kardex_cantidad := p_cantidad;
        v_stock_resultante := v_existencia_actual + p_cantidad;
    ELSE
        v_kardex_cantidad := -p_cantidad;
        v_stock_resultante := v_existencia_actual - p_cantidad;
        
        IF v_stock_resultante < 0 THEN
            RAISE EXCEPTION 'El ajuste resultaría en un stock negativo (% unidades), lo cual no está permitido.', v_stock_resultante;
        END IF;
    END IF;

    -- 4. Actualizar existencia en la tabla producto
    UPDATE producto
    SET "Existencia" = v_stock_resultante
    WHERE "IdProducto" = p_id_producto;

    -- 5. Insertar movimiento en Kardex
    INSERT INTO kardex (
        id_producto,
        tipo_movimiento,
        cantidad,
        stock_anterior,
        stock_resultante,
        precio_unitario,
        referencia
    ) VALUES (
        p_id_producto,
        p_tipo::tipo_movimiento_enum,
        v_kardex_cantidad,
        v_existencia_actual,
        v_stock_resultante,
        v_precio_unitario,
        p_motivo
    );
END;
$$;
