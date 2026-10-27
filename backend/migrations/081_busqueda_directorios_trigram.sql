CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- Solo text[]: preserva concat_ws (NULL omitidos, vacíos/espacios conservados).
CREATE FUNCTION public.directory_search_document(parts text[]) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT lower(concat_ws(' ',VARIADIC parts)); $$;

CREATE INDEX idx_cliente_busqueda_trgm ON public.cliente USING gin
  (public.directory_search_document(ARRAY["IdCliente"::text,"RFC"::text,"RazonSocial"::text,"CodigoPostal"::text]) public.gin_trgm_ops);
CREATE INDEX idx_proveedor_busqueda_trgm ON public.proveedor USING gin
  (public.directory_search_document(ARRAY["IdProveedor"::text,"RFC"::text,"RazonSocial"::text,"CodigoPostal"::text]) public.gin_trgm_ops);
CREATE INDEX idx_crm_unidad_busqueda_trgm ON public.crm_unidad_cliente USING gin
  (public.directory_search_document(ARRAY[vin::text,esn::text,numero_economico::text,placas::text]) public.gin_trgm_ops);
