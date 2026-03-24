const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto' });

const sql = `
CREATE OR REPLACE FUNCTION public.fn_get_devoluciones(p_limit integer DEFAULT 10, p_offset integer DEFAULT 0, p_term text DEFAULT ''::text)
 RETURNS TABLE(
    id_devolucion integer, 
    id_factura integer, 
    folio_factura character varying, 
    fecha timestamp without time zone, 
    monto_total numeric, 
    metodo_reembolso character varying, 
    cliente text,
    rfc text
 )
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        d.id_devolucion,
        d.id_factura,
        f.folio::varchar as folio_factura,
        d.fecha,
        d.monto_total,
        d.metodo_reembolso,
        c."RazonSocial"::text as cliente,
        c."RFC"::text as rfc
    FROM devolucion d
    JOIN factura f ON d.id_factura = f.id_factura
    LEFT JOIN cliente c ON f.id_cliente = c."IdCliente"
    WHERE (p_term = '' OR
           f.folio::text ILIKE '%' || p_term || '%' OR
           ('NC-' || d.id_devolucion::text) ILIKE '%' || p_term || '%' OR
           c."RazonSocial"::text ILIKE '%' || p_term || '%' OR
           c."RFC"::text ILIKE '%' || p_term || '%')
    ORDER BY d.id_devolucion DESC
    LIMIT p_limit OFFSET p_offset;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_get_devoluciones_count(p_term text DEFAULT ''::text)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_count bigint;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM devolucion d
    JOIN factura f ON d.id_factura = f.id_factura
    LEFT JOIN cliente c ON f.id_cliente = c."IdCliente"
    WHERE (p_term = '' OR
           f.folio::text ILIKE '%' || p_term || '%' OR
           ('NC-' || d.id_devolucion::text) ILIKE '%' || p_term || '%' OR
           c."RazonSocial"::text ILIKE '%' || p_term || '%' OR
           c."RFC"::text ILIKE '%' || p_term || '%');
    RETURN v_count;
END;
$function$;
`;

client.connect()
  .then(() => client.query(sql))
  .then(() => {
    console.log('fn_get_devoluciones creado con exito');
    process.exit(0);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
