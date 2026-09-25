-- Vencimiento controlado de apartados de inventario.

ALTER TABLE reserva_inventario
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

UPDATE reserva_inventario
SET expires_at = created_at + interval '7 days'
WHERE expires_at IS NULL AND estado = 'Activa';

ALTER TABLE reserva_inventario
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '7 days');

CREATE INDEX IF NOT EXISTS idx_reserva_vencimiento_activa
  ON reserva_inventario(expires_at, id_producto)
  WHERE estado = 'Activa';

COMMENT ON COLUMN reserva_inventario.expires_at IS
  'Fecha límite del apartado. Solo las reservas Activa pueden liberarse por vencimiento.';
