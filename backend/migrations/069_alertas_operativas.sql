-- Fecha compromiso para garantías y consultas eficientes del centro de alertas.
ALTER TABLE garantia ADD COLUMN IF NOT EXISTS fecha_compromiso timestamptz;
UPDATE garantia SET fecha_compromiso=created_at+interval '7 days' WHERE fecha_compromiso IS NULL;
ALTER TABLE garantia ALTER COLUMN fecha_compromiso SET DEFAULT (clock_timestamp()+interval '7 days');
ALTER TABLE garantia ALTER COLUMN fecha_compromiso SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_garantia_compromiso_abierta
  ON garantia(fecha_compromiso)
  WHERE estado NOT IN ('Cerrada','Rechazada');
CREATE INDEX IF NOT EXISTS idx_cotizacion_vencimiento_pendiente
  ON cotizacion(fecha_vencimiento)
  WHERE estatus='Pendiente';

DROP TRIGGER IF EXISTS trg_audit_jsonb_garantia ON garantia;
CREATE TRIGGER trg_audit_jsonb_garantia AFTER INSERT OR UPDATE OR DELETE ON garantia
FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
