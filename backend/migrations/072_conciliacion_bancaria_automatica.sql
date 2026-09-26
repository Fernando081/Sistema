-- Importación por lotes y conciliación bancaria automática, trazable y reversible.
CREATE TABLE IF NOT EXISTS tesoreria_importacion (
  id_importacion bigserial PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  id_cuenta integer NOT NULL REFERENCES tesoreria_cuenta(id_cuenta),
  nombre_archivo varchar(255) NOT NULL,
  sha256 char(64) NOT NULL,
  total_renglones integer NOT NULL DEFAULT 0,
  insertados integer NOT NULL DEFAULT 0,
  duplicados integer NOT NULL DEFAULT 0,
  conciliados_auto integer NOT NULL DEFAULT 0,
  errores jsonb NOT NULL DEFAULT '[]'::jsonb,
  id_user integer REFERENCES auth_user(id_user) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(id_cuenta,sha256)
);

ALTER TABLE tesoreria_movimiento
  ADD COLUMN IF NOT EXISTS id_importacion bigint REFERENCES tesoreria_importacion(id_importacion),
  ADD COLUMN IF NOT EXISTS fingerprint char(64),
  ADD COLUMN IF NOT EXISTS metodo_conciliacion varchar(12),
  ADD COLUMN IF NOT EXISTS puntaje_conciliacion numeric(5,2),
  ADD COLUMN IF NOT EXISTS observaciones varchar(500),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT clock_timestamp();

ALTER TABLE tesoreria_movimiento DROP CONSTRAINT IF EXISTS tesoreria_movimiento_estado_check;
ALTER TABLE tesoreria_movimiento DROP CONSTRAINT IF EXISTS tesoreria_movimiento_check;
ALTER TABLE tesoreria_movimiento ADD CONSTRAINT tesoreria_movimiento_estado_check
  CHECK(estado IN ('Pendiente','Conciliado','Ignorado'));
ALTER TABLE tesoreria_movimiento ADD CONSTRAINT tesoreria_movimiento_vinculo_check CHECK(
  (estado='Pendiente' AND id_caja_movimiento IS NULL AND conciliado_at IS NULL) OR
  (estado='Ignorado' AND id_caja_movimiento IS NULL AND conciliado_at IS NULL) OR
  (estado='Conciliado' AND id_caja_movimiento IS NOT NULL AND conciliado_at IS NOT NULL)
);
ALTER TABLE tesoreria_movimiento ADD CONSTRAINT tesoreria_movimiento_metodo_check
  CHECK(metodo_conciliacion IS NULL OR metodo_conciliacion IN ('Manual','Automatica'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_tesoreria_movimiento_fingerprint
  ON tesoreria_movimiento(id_cuenta,fingerprint) WHERE fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tesoreria_importacion_cuenta_fecha ON tesoreria_importacion(id_cuenta,created_at DESC);

DROP TRIGGER IF EXISTS trg_audit_jsonb_tesoreria_importacion ON tesoreria_importacion;
CREATE TRIGGER trg_audit_jsonb_tesoreria_importacion AFTER INSERT OR UPDATE OR DELETE ON tesoreria_importacion
FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
