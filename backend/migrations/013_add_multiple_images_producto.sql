-- Migration 013: Add multiple images support

-- Add the new jsonb column
ALTER TABLE producto ADD COLUMN IF NOT EXISTS imagenes JSONB DEFAULT '[]'::jsonb;

-- Drop the old column
ALTER TABLE producto DROP COLUMN IF EXISTS imagen_url;

-- Update fn_create_producto
CREATE OR REPLACE FUNCTION public.fn_create_producto(
    p_codigo character varying, p_id_unidad integer, p_id_objeto_impuesto integer, p_descripcion character varying, p_precio_unitario numeric, p_id_categoria integer, p_ubicacion character varying, p_id_clave_prod_o_serv integer, p_id_clave_unidad integer, p_marca character varying, p_objeto_impuesto_sat character varying DEFAULT '02'::character varying, p_tasa_iva numeric DEFAULT 0.16, p_aplica_retencion_isr boolean DEFAULT false, p_aplica_retencion_iva boolean DEFAULT false, p_imagenes jsonb DEFAULT '[]'::jsonb)
 RETURNS TABLE("IdProducto" integer, "Codigo" character varying, "IdUnidad" integer, "IdObjetoImpuesto" integer, "Descripcion" character varying, "PrecioUnitario" numeric, "IdCategoria" integer, "Ubicacion" character varying, "IdClaveProdOServ" integer, "IdClaveUnidad" integer, "Marca" character varying, "ObjetoImpuesto" character varying, "TasaIVA" numeric, "AplicaRetencionISR" boolean, "AplicaRetencionIVA" boolean, "imagenes" jsonb)
 LANGUAGE plpgsql
AS $function$
DECLARE
    new_id integer;
BEGIN
    INSERT INTO "producto" (
        "Codigo", "IdUnidad", "IdObjetoImpuesto", "Descripcion", 
        "PrecioUnitario", "IdCategoria", "Ubicacion", "IdClaveProdOServ", 
        "IdClaveUnidad", "Marca", "ObjetoImpuesto", "TasaIVA", 
        "AplicaRetencionISR", "AplicaRetencionIVA", "imagenes"
    ) VALUES (
        p_codigo, p_id_unidad, p_id_objeto_impuesto, p_descripcion, 
        p_precio_unitario, p_id_categoria, p_ubicacion, p_id_clave_prod_o_serv, 
        p_id_clave_unidad, p_marca, p_objeto_impuesto_sat, p_tasa_iva, 
        p_aplica_retencion_isr, p_aplica_retencion_iva, p_imagenes
    )
    RETURNING "producto"."IdProducto" INTO new_id;

    RETURN QUERY
    SELECT 
        p."IdProducto", p."Codigo", p."IdUnidad", p."IdObjetoImpuesto", p."Descripcion", 
        p."PrecioUnitario", p."IdCategoria", p."Ubicacion", p."IdClaveProdOServ", 
        p."IdClaveUnidad", p."Marca", p."ObjetoImpuesto", p."TasaIVA", 
        p."AplicaRetencionISR", p."AplicaRetencionIVA", p."imagenes"
    FROM "producto" p
    WHERE p."IdProducto" = new_id;
END;
$function$;

-- Update fn_update_producto
CREATE OR REPLACE FUNCTION public.fn_update_producto(
    p_id_producto integer, p_codigo character varying, p_id_unidad integer, p_id_objeto_impuesto integer, p_descripcion character varying, p_precio_unitario numeric, p_id_categoria integer, p_ubicacion character varying, p_id_clave_prod_o_serv integer, p_id_clave_unidad integer, p_marca character varying, p_objeto_impuesto_sat character varying DEFAULT '02'::character varying, p_tasa_iva numeric DEFAULT 0.16, p_aplica_retencion_isr boolean DEFAULT false, p_aplica_retencion_iva boolean DEFAULT false, p_imagenes jsonb DEFAULT '[]'::jsonb)
 RETURNS TABLE("IdProducto" integer, "Codigo" character varying, "IdUnidad" integer, "IdObjetoImpuesto" integer, "Descripcion" character varying, "PrecioUnitario" numeric, "IdCategoria" integer, "Ubicacion" character varying, "IdClaveProdOServ" integer, "IdClaveUnidad" integer, "Marca" character varying, "ObjetoImpuesto" character varying, "TasaIVA" numeric, "AplicaRetencionISR" boolean, "AplicaRetencionIVA" boolean, "imagenes" jsonb)
 LANGUAGE plpgsql
AS $function$
BEGIN
    UPDATE "producto"
    SET 
        "Codigo" = p_codigo,
        "IdUnidad" = p_id_unidad,
        "IdObjetoImpuesto" = p_id_objeto_impuesto,
        "Descripcion" = p_descripcion,
        "PrecioUnitario" = p_precio_unitario,
        "IdCategoria" = p_id_categoria,
        "Ubicacion" = p_ubicacion,
        "IdClaveProdOServ" = p_id_clave_prod_o_serv,
        "IdClaveUnidad" = p_id_clave_unidad,
        "Marca" = p_marca,
        "ObjetoImpuesto" = p_objeto_impuesto_sat,
        "TasaIVA" = p_tasa_iva,
        "AplicaRetencionISR" = p_aplica_retencion_isr,
        "AplicaRetencionIVA" = p_aplica_retencion_iva,
        "imagenes" = p_imagenes
    WHERE "producto"."IdProducto" = p_id_producto;

    RETURN QUERY
    SELECT 
        p."IdProducto", p."Codigo", p."IdUnidad", p."IdObjetoImpuesto", p."Descripcion", 
        p."PrecioUnitario", p."IdCategoria", p."Ubicacion", p."IdClaveProdOServ", 
        p."IdClaveUnidad", p."Marca", p."ObjetoImpuesto", p."TasaIVA", 
        p."AplicaRetencionISR", p."AplicaRetencionIVA", p."imagenes"
    FROM "producto" p
    WHERE p."IdProducto" = p_id_producto;
END;
$function$;

-- Update fn_get_productos
CREATE OR REPLACE FUNCTION public.fn_get_productos()
 RETURNS TABLE("IdProducto" integer, "Codigo" character varying, "IdUnidad" integer, "IdObjetoImpuesto" integer, "Descripcion" character varying, "PrecioUnitario" numeric, "IdCategoria" integer, "Ubicacion" character varying, "IdClaveProdOServ" integer, "IdClaveUnidad" integer, "Marca" character varying, "ObjetoImpuesto" character varying, "TasaIVA" numeric, "AplicaRetencionISR" boolean, "AplicaRetencionIVA" boolean, "Existencia" numeric, "CategoriaNombre" character varying, "ClaveProdServ" character varying, "DescripcionProdServ" text, "ClaveUnidadSat" character varying, "DescripcionUnidadSat" text, "EquivalentesJSON" jsonb, "imagenes" jsonb)
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
    ORDER BY p."IdProducto" DESC;
END;
$function$;

-- Update fn_get_producto_by_id
CREATE OR REPLACE FUNCTION public.fn_get_producto_by_id(p_id integer)
 RETURNS TABLE("IdProducto" integer, "Codigo" character varying, "IdUnidad" integer, "IdObjetoImpuesto" integer, "Descripcion" character varying, "PrecioUnitario" numeric, "IdCategoria" integer, "Ubicacion" character varying, "IdClaveProdOServ" integer, "IdClaveUnidad" integer, "Marca" character varying, "ObjetoImpuesto" character varying, "TasaIVA" numeric, "AplicaRetencionISR" boolean, "AplicaRetencionIVA" boolean, "CategoriaNombre" character varying, "ClaveProdServ" character varying, "DescripcionProdServ" text, "ClaveUnidadSat" character varying, "DescripcionUnidadSat" text, "imagenes" jsonb)
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
        p."imagenes"
    FROM "producto" p
    LEFT JOIN "categoria" c ON p."IdCategoria" = c."IdCategoria"
    LEFT JOIN "claveproductooservicio" cps ON p."IdClaveProdOServ" = cps."IdClaveProdOServ"
    LEFT JOIN "claveunidad" cu ON p."IdClaveUnidad" = cu."IdClaveUnidad"
    WHERE p."IdProducto" = p_id;
END;
$function$;
