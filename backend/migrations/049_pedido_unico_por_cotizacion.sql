-- Una cotización solo puede originar un pedido de venta.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pedido_cotizacion
  ON pedido_venta(id_cotizacion)
  WHERE id_cotizacion IS NOT NULL;
