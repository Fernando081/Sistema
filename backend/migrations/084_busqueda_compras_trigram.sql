CREATE INDEX idx_compra_busqueda_trgm ON public.compra USING gin
 (public.directory_search_document(ARRAY[id_compra::text,folio_factura_proveedor::text]) public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_compra_proveedor_busqueda ON public.compra(id_proveedor);
