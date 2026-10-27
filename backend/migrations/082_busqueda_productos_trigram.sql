CREATE FUNCTION public.product_application_text(parts text[]) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$SELECT concat_ws(' ',VARIADIC parts)$$;
CREATE INDEX idx_producto_codigo_trgm ON public.producto USING gin(COALESCE("Codigo",'') public.gin_trgm_ops);
CREATE INDEX idx_producto_descripcion_trgm ON public.producto USING gin(COALESCE("Descripcion",'') public.gin_trgm_ops);
CREATE INDEX idx_producto_marca_trgm ON public.producto USING gin(COALESCE("Marca",'') public.gin_trgm_ops);
CREATE INDEX idx_categoria_descripcion_trgm ON public.categoria USING gin(COALESCE("Descripcion",'') public.gin_trgm_ops);
CREATE INDEX idx_producto_oem_trgm ON public.producto_numero_parte USING gin(numero_normalizado public.gin_trgm_ops);
CREATE INDEX idx_producto_aplicacion_trgm ON public.producto_aplicacion USING gin
 (public.product_application_text(ARRAY[fabricante_equipo::text,modelo::text,motor::text,restricciones::text]) public.gin_trgm_ops);
CREATE INDEX idx_producto_categoria_busqueda ON public.producto("IdCategoria");
