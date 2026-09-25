-- Control de edición concurrente y consultas de agenda/ventas perdidas.
ALTER TABLE crm_oportunidad ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_crm_agenda_abierta
  ON crm_oportunidad(fecha_siguiente_accion, id_oportunidad)
  WHERE etapa NOT IN ('Ganada', 'Perdida');
CREATE INDEX IF NOT EXISTS idx_venta_perdida_motivo_fecha
  ON venta_perdida(motivo, created_at DESC, id_venta_perdida DESC);
CREATE INDEX IF NOT EXISTS idx_venta_perdida_fecha
  ON venta_perdida(created_at DESC, id_venta_perdida DESC);

-- NOT VALID conserva los registros antiguos de prueba y valida nuevas escrituras.
ALTER TABLE crm_oportunidad ADD CONSTRAINT crm_empresa_no_vacia
  CHECK (length(btrim(empresa)) > 0) NOT VALID;
ALTER TABLE crm_oportunidad ADD CONSTRAINT crm_perdida_con_motivo
  CHECK (etapa <> 'Perdida' OR length(btrim(motivo_perdida)) > 0 AND motivo_perdida IS NOT NULL) NOT VALID;
ALTER TABLE crm_seguimiento ADD CONSTRAINT crm_seguimiento_no_vacio
  CHECK (length(btrim(detalle)) > 0) NOT VALID;
ALTER TABLE venta_perdida ADD CONSTRAINT crm_busqueda_no_vacia
  CHECK (length(btrim(descripcion_buscada)) > 0) NOT VALID;
