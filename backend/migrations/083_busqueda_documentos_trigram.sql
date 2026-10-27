-- Función textual de 081: concat_ws/lower, sin cambiar NULL ni espacios.
CREATE INDEX idx_cotizacion_busqueda_trgm ON public.cotizacion USING gin
 (public.directory_search_document(ARRAY[folio::text,'C-'||folio::text,nombre_receptor::text,rfc_receptor::text]) public.gin_trgm_ops);
CREATE INDEX idx_factura_busqueda_trgm ON public.factura USING gin
 (public.directory_search_document(ARRAY[folio::text,serie::text||folio::text,serie::text||'-'||folio::text,nombre_receptor::text,rfc_receptor::text]) public.gin_trgm_ops);
