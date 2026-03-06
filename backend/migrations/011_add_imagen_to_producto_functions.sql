-- Migration 011: Add imagen_url to producto functions

-- No need to drop functions because we match the new signature (15 args)
CREATE OR REPLACE FUNCTION public.fn_create_producto(
    p_codigo character varying, 
    p_id_unidad integer, 
    p_id_objeto_impuesto integer, 
    p_descripcion character varying, 
    p_precio_unitario numeric, 
    p_id_categoria integer, 
    p_ubicacion character varying, 
    p_id_clave_prod_serv integer, 
    p_id_clave_unidad integer, 
    p_marca character varying, 
    p_objeto_impuesto_sat character varying DEFAULT '02'::character varying, 
    p_tasa_iva numeric DEFAULT 0.16, 
    p_aplica_retencion_isr boolean DEFAULT false, 
    p_aplica_retencion_iva boolean DEFAULT false,
    p_imagen_url character varying DEFAULT NULL
)
 RETURNS SETOF producto
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_nuevo_producto "producto";
BEGIN
    INSERT INTO "producto" (
        "Codigo", "IdUnidad", "IdObjetoImpuesto", "Descripcion", 
        "PrecioUnitario", "IdCategoria", "Ubicacion", 
        "IdClaveProdOServ", "IdClaveUnidad", "Marca",
        "ObjetoImpuesto", "TasaIVA", "AplicaRetencionISR", "AplicaRetencionIVA",
        "imagen_url"
    ) VALUES (
        p_codigo, p_id_unidad, p_id_objeto_impuesto, p_descripcion, 
        p_precio_unitario, p_id_categoria, p_ubicacion, 
        p_id_clave_prod_serv, p_id_clave_unidad, p_marca,
        p_objeto_impuesto_sat, p_tasa_iva, p_aplica_retencion_isr, p_aplica_retencion_iva,
        p_imagen_url
    )
    RETURNING * INTO v_nuevo_producto;

    -- IMPORTANTE: También inicializamos su registro en la tabla de inventario
    INSERT INTO "inventario" ("IdProducto", "Existencias")
    VALUES (v_nuevo_producto."IdProducto", 0);
    
    RETURN NEXT v_nuevo_producto;
    RETURN;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_update_producto(
    p_id_producto integer, 
    p_codigo character varying, 
    p_id_unidad integer, 
    p_id_objeto_impuesto integer, 
    p_descripcion character varying, 
    p_precio_unitario numeric, 
    p_id_categoria integer, 
    p_ubicacion character varying, 
    p_id_clave_prod_serv integer, 
    p_id_clave_unidad integer, 
    p_marca character varying, 
    p_objeto_impuesto_sat character varying, 
    p_tasa_iva numeric, 
    p_aplica_retencion_isr boolean, 
    p_aplica_retencion_iva boolean,
    p_imagen_url character varying
)
 RETURNS SETOF producto
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    UPDATE "producto" SET
        "Codigo" = p_codigo,
        "IdUnidad" = p_id_unidad,
        "IdObjetoImpuesto" = p_id_objeto_impuesto,
        "Descripcion" = p_descripcion,
        "PrecioUnitario" = p_precio_unitario,
        "IdCategoria" = p_id_categoria,
        "Ubicacion" = p_ubicacion,
        "IdClaveProdOServ" = p_id_clave_prod_serv,
        "IdClaveUnidad" = p_id_clave_unidad,
        "Marca" = p_marca,
        "ObjetoImpuesto" = p_objeto_impuesto_sat,
        "TasaIVA" = p_tasa_iva,
        "AplicaRetencionISR" = p_aplica_retencion_isr,
        "AplicaRetencionIVA" = p_aplica_retencion_iva,
        "imagen_url" = p_imagen_url
    WHERE "IdProducto" = p_id_producto
    RETURNING *;
END;
$function$;
