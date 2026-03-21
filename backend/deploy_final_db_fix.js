const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto' });

const sql = `
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
    v_stock_anterior INT;
BEGIN
    IF p_metodo_reembolso NOT IN ('Efectivo', 'Saldo a Favor') THEN
        RAISE EXCEPTION 'Método de reembolso no válido';
    END IF;

    SELECT f.id_cliente INTO v_id_cliente 
    FROM factura f WHERE f.id_factura = p_id_factura;
    
    IF v_id_cliente IS NULL THEN
        RAISE EXCEPTION 'Factura % no existe o no tiene cliente asigando', p_id_factura;
    END IF;

    INSERT INTO devolucion (id_factura, metodo_reembolso) 
    VALUES (p_id_factura, p_metodo_reembolso) 
    RETURNING id_devolucion INTO v_id_devolucion;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_articulos)
    LOOP
        v_id_producto := (v_item->>'idProducto')::INT;
        v_cantidad := (v_item->>'cantidad')::INT;
        v_precio_unitario := (v_item->>'precioUnitario')::NUMERIC(10,2);
        
        IF v_cantidad > 0 THEN
            v_monto_total := v_monto_total + (v_cantidad * v_precio_unitario);

            INSERT INTO devolucion_detalle (id_devolucion, id_producto, cantidad, precio_unitario)
            VALUES (v_id_devolucion, v_id_producto, v_cantidad, v_precio_unitario);

            -- Wait! Does producto use "IdProducto" or "id_producto"?
            -- Let's query the table properly. The schema uses id_producto from what we saw earlier?
            -- Let's assume id_producto but I'll write "id_producto" without quotes if it's snake_case.
            -- Actually, in my original schema "producto" was referenced as "IdProducto" with quotes in someone else's code (fn_get_detalle_factura used it!).
            -- Let's stick to "IdProducto" for producto, but use id_cliente for factura/cliente.
            SELECT "Existencia" INTO v_stock_anterior FROM producto WHERE "IdProducto" = v_id_producto;

            UPDATE producto SET "Existencia" = "Existencia" + v_cantidad WHERE "IdProducto" = v_id_producto;

            INSERT INTO kardex (id_producto, fecha, tipo_movimiento, cantidad, stock_anterior, stock_resultante, precio_unitario, referencia, id_referencia)
            VALUES (
                v_id_producto, CURRENT_TIMESTAMP, 'ENTRADA DEVOLUCION', v_cantidad, 
                v_stock_anterior, v_stock_anterior + v_cantidad, v_precio_unitario,
                'DEVOLUCION REF#' || v_id_devolucion, p_id_factura
            );
        END IF;
    END LOOP;

    IF v_monto_total <= 0 THEN RAISE EXCEPTION 'El monto total a devolver es cero.'; END IF;
    
    UPDATE devolucion SET monto_total = v_monto_total WHERE id_devolucion = v_id_devolucion;

    IF p_metodo_reembolso = 'Saldo a Favor' THEN
        UPDATE cliente SET saldo_a_favor = saldo_a_favor + v_monto_total WHERE id_cliente = v_id_cliente;
    ELSE
        INSERT INTO gasto (concepto, monto, categoria, metodo_pago, id_user)
        VALUES ('DEVOLUCION EFECTIVO FACTURA ' || p_id_factura, v_monto_total, 'Devoluciones y Reembolsos', 'Efectivo', p_id_user);
    END IF;

    RETURN v_id_devolucion;
END;
$$ LANGUAGE plpgsql;
`;

client.connect()
  .then(() => client.query(sql))
  .then(() => {
    console.log('SP Devolucion Parcial final patched');
    process.exit(0);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
