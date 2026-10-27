// Callers define linked_quotes(id_cotizacion,id_oportunidad,id_cliente).
// Inspect both paths before attributing a document; conflicting quote/customer
// links are excluded. DISTINCT prevents the same document being counted twice.
export const commercialSalesCtes = `sale_links AS MATERIALIZED (
  SELECT DISTINCT f.id_factura,m.id_oportunidad,m.id_cotizacion,
    COALESCE((f.id_cliente=m.id_cliente AND f.estatus IS NOT NULL AND
      (p.id_pedido IS NULL OR (p.id_cliente=m.id_cliente AND p.estado<>'Cancelado')) AND
      (f.id_cotizacion IS NULL OR p.id_cotizacion IS NULL OR f.id_cotizacion=p.id_cotizacion)),false) AS coherent,
    (f.estatus::text IN ('Cancelada','Cancelado') OR EXISTS
      (SELECT 1 FROM fiscal_documento fd WHERE fd.id_factura=f.id_factura AND fd.estado='Cancelado')) AS cancelled
  FROM linked_quotes m JOIN factura f ON f.id_cotizacion=m.id_cotizacion OR EXISTS
    (SELECT 1 FROM pedido_venta pv WHERE pv.id_pedido=f.id_pedido AND pv.id_cotizacion=m.id_cotizacion)
  LEFT JOIN pedido_venta p ON p.id_pedido=f.id_pedido
  WHERE f.tipo_comprobante='I'
), valid_sales AS (
  SELECT DISTINCT id_factura,id_oportunidad,id_cotizacion FROM sale_links WHERE coherent AND NOT cancelled
)`;

export interface WebCommercialMetrics {
  cotizacionesVinculadas: number; solicitudesConCotizacion: number; solicitudesConVenta: number;
  documentosVentaVigentes: number; documentosCancelados: number; documentosInconsistentes: number;
}
