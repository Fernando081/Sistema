-- Migration 019: Set LIMIT and OFFSET on get_productos and get_facturas for paginated queries

-- Update fn_get_facturas with LIMIT and OFFSET parameters
DROP FUNCTION IF EXISTS public.fn_get_facturas();
CREATE OR REPLACE FUNCTION public.fn_get_facturas(p_limit integer DEFAULT 10, p_offset integer DEFAULT 0)
 RETURNS SETOF factura
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    SELECT * FROM factura 
    ORDER BY id_factura DESC -- Las más recientes primero
    LIMIT p_limit OFFSET p_offset;
END;
$function$;

-- Update fn_get_productos with LIMIT and OFFSET parameters
DROP FUNCTION IF EXISTS public.fn_get_productos();
CREATE OR REPLACE FUNCTION public.fn_get_productos(p_limit integer DEFAULT 10, p_offset integer DEFAULT 0)
 RETURNS TABLE("IdProducto" integer, "Codigo" character varying, "IdUnidad" integer, "IdObjetoImpuesto" integer, "Descripcion" character varying, "PrecioUnitario" numeric, "IdCategoria" integer, "Ubicacion" character varying, "IdClaveProdOServ" integer, "IdClaveUnidad" integer, "Marca" character varying, "ObjetoImpuesto" character varying, "TasaIVA" numeric, "AplicaRetencionISR" boolean, "AplicaRetencionIVA" boolean, "Existencia" numeric, "CategoriaNombre" character varying, "ClaveProdServ" character varying, "DescripcionProdServ" text, "ClaveUnidadSat" character varying, "DescripcionUnidadSat" text, "EquivalentesJSON" jsonb, imagenes jsonb)
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        p."IdProducto", p."Codigo", p."IdUnidad", p."IdObjetoImpuesto", p."Descripcion", 
        p."PrecioUnitario", p."IdCategoria", p."Ubicacion", p."IdClaveProdOServ", 
        p."IdClaveUnidad", p."Marca", p."ObjetoImpuesto", p."TasaIVA", 
        p."AplicaRetencionISR", p."AplicaRetencionIVA",
        p."Existencia",
        c."Descripcion" AS "CategoriaNombre",
        cps."Clave" AS "ClaveProdServ",
        CAST(cps."Descripcion" AS text) AS "DescripcionProdServ",
        cu."Clave" AS "ClaveUnidadSat",
        CAST(cu."Descripcion" AS text) AS "DescripcionUnidadSat",
        
        -- SUBQUERY para traer los equivalentes como una lista [1, 5, 8]
        COALESCE((
            SELECT jsonb_agg(pe."IdProductoEquivalente")
            FROM producto_equivalente pe
            WHERE pe."IdProducto" = p."IdProducto"
        ), '[]'::jsonb) AS "EquivalentesJSON",
        p."imagenes"

    FROM "producto" p
    LEFT JOIN "categoria" c ON p."IdCategoria" = c."IdCategoria"
    LEFT JOIN "claveproductooservicio" cps ON p."IdClaveProdOServ" = cps."IdClaveProdOServ"
    LEFT JOIN "claveunidad" cu ON p."IdClaveUnidad" = cu."IdClaveUnidad"
    ORDER BY p."IdProducto" DESC
    LIMIT p_limit OFFSET p_offset;
END;
$function$;
