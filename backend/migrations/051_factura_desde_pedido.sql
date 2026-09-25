ALTER TABLE factura ADD COLUMN IF NOT EXISTS id_pedido integer NULL;

DO $$ BEGIN
  ALTER TABLE factura ADD CONSTRAINT fk_factura_pedido
    FOREIGN KEY (id_pedido) REFERENCES pedido_venta(id_pedido) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_factura_pedido
  ON factura(id_pedido) WHERE id_pedido IS NOT NULL;
