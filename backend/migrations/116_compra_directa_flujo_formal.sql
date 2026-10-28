-- H02-b (27/10/2026): "Nueva compra" deja de crear deudas en el modelo anterior (compra.saldo_pendiente).
-- Ahora registra orden → recepción → factura de proveedor aprobada (y pago si es de contado) en una
-- sola transacción. La columna distingue esas órdenes de las de Abastecimiento para el historial.
-- Las compras anteriores con saldo siguen pagándose en "Compras anteriores" hasta llegar a cero.
ALTER TABLE orden_compra ADD COLUMN IF NOT EXISTS origen varchar(30) NOT NULL DEFAULT 'Abastecimiento';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_orden_compra_origen') THEN
    ALTER TABLE orden_compra ADD CONSTRAINT ck_orden_compra_origen
      CHECK (origen IN ('Abastecimiento', 'Compra directa'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orden_compra_compra_directa
  ON orden_compra (created_at DESC, id_orden DESC)
  WHERE origen = 'Compra directa';
