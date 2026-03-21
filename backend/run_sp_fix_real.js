const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto' });

const sql = `
DROP FUNCTION IF EXISTS fn_get_detalle_factura(integer);
CREATE OR REPLACE FUNCTION fn_get_detalle_factura(p_id_factura integer)
RETURNS TABLE(
    id_producto integer,
    codigo_producto character varying,
    descripcion_producto text,
    unidad character varying,
    cantidad numeric,
    precio_unitario numeric,
    importe numeric,
    pct_iva numeric,
    importe_iva numeric,
    pct_ret_isr numeric,
    importe_ret_isr numeric
) AS $$
BEGIN
    RETURN QUERY 
    SELECT 
        p."IdProducto" AS id_producto,
        p."Codigo" AS codigo_producto,
        d.descripcion::text AS descripcion_producto,
        d.unidad_sat AS unidad,
        d.cantidad, 
        d.valor_unitario AS precio_unitario, 
        d.importe,
        d.tasa_iva AS pct_iva,
        d.importe_iva,
        d.tasa_ret_isr AS pct_ret_isr,
        d.importe_ret_isr
    FROM conceptofactura d
    JOIN producto p ON d.id_producto = p."IdProducto"
    WHERE d.id_factura = p_id_factura;
END;
$$ LANGUAGE plpgsql;
`;

client.connect()
  .then(() => client.query(sql))
  .then(() => {
    console.log('SP Updated successfully mapping conceptofactura');
    process.exit(0);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
