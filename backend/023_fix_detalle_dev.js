const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto' });

const sql = `
DROP FUNCTION IF EXISTS public.fn_get_detalle_factura(integer);

CREATE OR REPLACE FUNCTION public.fn_get_detalle_factura(p_id_factura integer)
 RETURNS TABLE(
    id_producto integer, 
    codigo_producto character varying, 
    descripcion_producto text, 
    unidad character varying, 
    cantidad numeric, 
    cantidad_devuelta numeric,
    precio_unitario numeric, 
    importe numeric, 
    pct_iva numeric, 
    importe_iva numeric, 
    pct_ret_isr numeric, 
    importe_ret_isr numeric
 )
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        p."IdProducto" AS id_producto,
        p."Codigo" AS codigo_producto,
        d.descripcion::text AS descripcion_producto,
        d.unidad_sat AS unidad,
        d.cantidad,
        COALESCE((
            SELECT SUM(dd.cantidad) 
            FROM devolucion_detalle dd 
            JOIN devolucion dev ON dev.id_devolucion = dd.id_devolucion 
            WHERE dev.id_factura = p_id_factura 
              AND dd.id_producto = p."IdProducto"
        ), 0)::numeric AS cantidad_devuelta,
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
$function$;
`;

client.connect()
  .then(() => client.query(sql))
  .then(() => {
    console.log('fn_get_detalle_factura modificado');
    process.exit(0);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
