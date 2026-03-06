-- Migration 012: Add imagen_url to GET functions

CREATE OR REPLACE FUNCTION public.fn_get_producto_by_id(p_id integer)
 RETURNS TABLE("IdProducto" integer, "Codigo" character varying, "IdUnidad" integer, "IdObjetoImpuesto" integer, "Descripcion" character varying, "PrecioUnitario" numeric, "IdCategoria" integer, "Ubicacion" character varying, "IdClaveProdOServ" integer, "IdClaveUnidad" integer, "Marca" character varying, "ObjetoImpuesto" character varying, "TasaIVA" numeric, "AplicaRetencionISR" boolean, "AplicaRetencionIVA" boolean, "CategoriaNombre" character varying, "ClaveProdServ" character varying, "DescripcionProdServ" text, "ClaveUnidadSat" character varying, "DescripcionUnidadSat" text, "imagen_url" character varying)
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        p."IdProducto", p."Codigo", p."IdUnidad", p."IdObjetoImpuesto", p."Descripcion", 
        p."PrecioUnitario", p."IdCategoria", p."Ubicacion", p."IdClaveProdOServ", 
        p."IdClaveUnidad", p."Marca", p."ObjetoImpuesto", p."TasaIVA", 
        p."AplicaRetencionISR", p."AplicaRetencionIVA",
        -- Joins
        c."Descripcion" AS "CategoriaNombre",
        cps."Clave" AS "ClaveProdServ",
        CAST(cps."Descripcion" AS text) AS "DescripcionProdServ",
        cu."Clave" AS "ClaveUnidadSat",
        CAST(cu."Descripcion" AS text) AS "DescripcionUnidadSat",
        p."imagen_url"
    FROM "producto" p
    LEFT JOIN "categoria" c ON p."IdCategoria" = c."IdCategoria"
    LEFT JOIN "claveproductooservicio" cps ON p."IdClaveProdOServ" = cps."IdClaveProdOServ"
    LEFT JOIN "claveunidad" cu ON p."IdClaveUnidad" = cu."IdClaveUnidad"
    WHERE p."IdProducto" = p_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_get_productos()
 RETURNS TABLE("IdProducto" integer, "Codigo" character varying, "IdUnidad" integer, "IdObjetoImpuesto" integer, "Descripcion" character varying, "PrecioUnitario" numeric, "IdCategoria" integer, "Ubicacion" character varying, "IdClaveProdOServ" integer, "IdClaveUnidad" integer, "Marca" character varying, "ObjetoImpuesto" character varying, "TasaIVA" numeric, "AplicaRetencionISR" boolean, "AplicaRetencionIVA" boolean, "Existencia" numeric, "CategoriaNombre" character varying, "ClaveProdServ" character varying, "DescripcionProdServ" text, "ClaveUnidadSat" character varying, "DescripcionUnidadSat" text, "EquivalentesJSON" jsonb, "imagen_url" character varying)
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
        p."imagen_url"

    FROM "producto" p
    LEFT JOIN "categoria" c ON p."IdCategoria" = c."IdCategoria"
    LEFT JOIN "claveproductooservicio" cps ON p."IdClaveProdOServ" = cps."IdClaveProdOServ"
    LEFT JOIN "claveunidad" cu ON p."IdClaveUnidad" = cu."IdClaveUnidad"
    ORDER BY p."IdProducto" DESC;
END;
$function$
;
