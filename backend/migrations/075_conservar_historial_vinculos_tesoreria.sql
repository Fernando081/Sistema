-- Conserva los vínculos revertidos para auditoría y permite reutilizar sólo el vínculo activo.
ALTER TABLE tesoreria_conciliacion_sistema ADD COLUMN activo boolean NOT NULL DEFAULT true;
ALTER TABLE tesoreria_conciliacion_sistema DROP CONSTRAINT IF EXISTS tesoreria_conciliacion_sistema_id_caja_movimiento_key;
CREATE UNIQUE INDEX uq_tesoreria_conciliacion_sistema_activo
  ON tesoreria_conciliacion_sistema(id_caja_movimiento) WHERE activo;
