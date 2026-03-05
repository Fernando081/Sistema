const { Client } = require('pg');
const c = new Client('postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto');

async function fix() {
  await c.connect();
  try {
     await c.query("ALTER TYPE tipo_movimiento_enum ADD VALUE IF NOT EXISTS 'ENTRADA POR DEVOLUCION'");
     console.log("Enum agregado/validado OK");
  } catch(e) { console.log(e.message); }

  const sql = `
CREATE OR REPLACE PROCEDURE sp_cancelar_factura(p_id_venta INT)
LANGUAGE plpgsql
AS $$
DECLARE
    v_estatus VARCHAR;
    v_item RECORD;
BEGIN
    SELECT estatus::varchar INTO v_estatus FROM factura WHERE id_factura = p_id_venta;
    IF v_estatus IS NULL THEN
        RAISE EXCEPTION 'Factura no encontrada';
    END IF;
    IF v_estatus = 'Cancelada' THEN
        RAISE EXCEPTION 'La factura ya se encuentra cancelada';
    END IF;

    UPDATE factura SET estatus = 'Cancelada'::estatus_factura_enum, saldo_pendiente = 0 WHERE id_factura = p_id_venta;

    FOR v_item IN (SELECT id_producto, cantidad, valor_unitario FROM conceptofactura WHERE id_factura = p_id_venta) LOOP
        UPDATE producto SET "Existencia" = "Existencia" + v_item.cantidad WHERE "IdProducto" = v_item.id_producto;
        
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

    DELETE FROM pago WHERE id_factura = p_id_venta;
END;
$$;
  `;
  try {
      await c.query(sql);
      console.log("SP arreglado");
  } catch(e) {
      console.log(e.message);
  }
  await c.end();
}
fix();
