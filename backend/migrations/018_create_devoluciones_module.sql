-- 1. Create devolucion table
CREATE TABLE IF NOT EXISTS devolucion (
    id_devolucion SERIAL PRIMARY KEY,
    id_factura INT NOT NULL REFERENCES factura(id_factura) ON DELETE CASCADE,
    fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    monto_total NUMERIC(10,2) NOT NULL DEFAULT 0,
    metodo_reembolso VARCHAR(50) NOT NULL CHECK (metodo_reembolso IN ('Efectivo', 'Saldo a Favor')),
    uuid_cfdi_egreso VARCHAR(36)
);

-- 2. Create devolucion_detalle table
CREATE TABLE IF NOT EXISTS devolucion_detalle (
    id_devolucion INT NOT NULL REFERENCES devolucion(id_devolucion) ON DELETE CASCADE,
    id_producto INT NOT NULL REFERENCES producto("IdProducto") ON DELETE CASCADE,
    cantidad INT NOT NULL,
    precio_unitario NUMERIC(10,2) NOT NULL,
    PRIMARY KEY (id_devolucion, id_producto)
);

-- 3. Add saldo_a_favor to cliente
ALTER TABLE cliente ADD COLUMN IF NOT EXISTS saldo_a_favor NUMERIC(10,2) NOT NULL DEFAULT 0;

-- 4. Stored Procedure for Partial Returns
CREATE OR REPLACE FUNCTION sp_procesar_devolucion_parcial(
    p_id_factura INT,
    p_metodo_reembolso VARCHAR,
    p_articulos JSONB,
    p_id_user INT DEFAULT NULL
) RETURNS INT AS $$
DECLARE
    v_id_devolucion INT;
    v_monto_total NUMERIC(10,2) := 0;
    v_item JSONB;
    v_id_producto INT;
    v_cantidad INT;
    v_precio_unitario NUMERIC(10,2);
    v_id_cliente INT;
BEGIN
    -- Validar método
    IF p_metodo_reembolso NOT IN ('Efectivo', 'Saldo a Favor') THEN
        RAISE EXCEPTION 'Método de reembolso no válido';
    END IF;

    -- Obtener Cliente
    SELECT f."IdCliente" INTO v_id_cliente 
    FROM factura f 
    WHERE f.id_factura = p_id_factura;
    
    IF v_id_cliente IS NULL THEN
        RAISE EXCEPTION 'Factura % no existe o no tiene cliente asigando', p_id_factura;
    END IF;

    -- Insertar Cabecera
    INSERT INTO devolucion (id_factura, metodo_reembolso) 
    VALUES (p_id_factura, p_metodo_reembolso) 
    RETURNING id_devolucion INTO v_id_devolucion;

    -- Procesar Detalle
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_articulos)
    LOOP
        v_id_producto := (v_item->>'idProducto')::INT;
        v_cantidad := (v_item->>'cantidad')::INT;
        v_precio_unitario := (v_item->>'precioUnitario')::NUMERIC(10,2);
        
        IF v_cantidad > 0 THEN
            v_monto_total := v_monto_total + (v_cantidad * v_precio_unitario);

            -- Detalle Devolución
            INSERT INTO devolucion_detalle (id_devolucion, id_producto, cantidad, precio_unitario)
            VALUES (v_id_devolucion, v_id_producto, v_cantidad, v_precio_unitario);

            -- Retornar al Inventario
            UPDATE producto SET "Existencia" = "Existencia" + v_cantidad WHERE "IdProducto" = v_id_producto;

            -- Historial Kardex
            INSERT INTO kardex (id_producto, fecha, tipo_movimiento, cantidad, id_factura_referencia, motivo)
            VALUES (
                v_id_producto, 
                CURRENT_TIMESTAMP, 
                'ENTRADA DEVOLUCION', 
                v_cantidad, 
                p_id_factura, 
                'DEVOLUCION PARCIAL REF#' || v_id_devolucion 
            );
        END IF;
    END LOOP;

    -- Actualizar Total Resultante
    IF v_monto_total <= 0 THEN
        RAISE EXCEPTION 'El monto total a devolver es cero. Revise las cantidades.';
    END IF;
    UPDATE devolucion SET monto_total = v_monto_total WHERE id_devolucion = v_id_devolucion;

    -- Asentar Financieramente el Reembolso
    IF p_metodo_reembolso = 'Saldo a Favor' THEN
        UPDATE cliente SET saldo_a_favor = saldo_a_favor + v_monto_total WHERE "IdCliente" = v_id_cliente;
    ELSE
        -- Efectivo: Regresar dinero a mano (Afecta triggers de saldo en Gasto)
        INSERT INTO gasto (concepto, monto, categoria, metodo_pago, id_user)
        VALUES ('DEVOLUCION EFECTIVO FACTURA ' || p_id_factura, v_monto_total, 'Devoluciones y Reembolsos', 'Efectivo', p_id_user);
    END IF;

    RETURN v_id_devolucion;
END;
$$ LANGUAGE plpgsql;
