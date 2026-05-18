-- Migración 024: Añadir filtro por tipo de comprobante en historial

DROP FUNCTION IF EXISTS public.fn_get_facturas(integer, integer, text);

CREATE OR REPLACE FUNCTION public.fn_get_facturas(p_limit integer DEFAULT 10, p_offset integer DEFAULT 0, p_term text DEFAULT ''::text, p_tipo text DEFAULT ''::text)
 RETURNS SETOF factura
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    SELECT * FROM factura
    WHERE (p_term = '' OR 
           folio::text ILIKE '%' || p_term || '%' OR
           ('A' || folio::text) ILIKE '%' || p_term || '%' OR
           nombre_receptor ILIKE '%' || p_term || '%' OR
           rfc_receptor ILIKE '%' || p_term || '%')
      AND (p_tipo = '' OR p_tipo IS NULL OR tipo_comprobante = p_tipo)
    ORDER BY id_factura DESC
    LIMIT p_limit OFFSET p_offset;
END;
$function$;
