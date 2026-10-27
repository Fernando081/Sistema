-- Vínculos explícitos; no infiere atribución por teléfono, nombre o etapa.
ALTER TABLE crm_oportunidad ADD CONSTRAINT uq_crm_oportunidad_cliente UNIQUE(id_oportunidad,id_cliente);
ALTER TABLE cotizacion ADD CONSTRAINT uq_cotizacion_cliente UNIQUE(id_cotizacion,id_cliente);

CREATE TABLE crm_oportunidad_cotizacion (
  id_cotizacion integer PRIMARY KEY,
  id_oportunidad integer NOT NULL,
  id_cliente integer NOT NULL,
  id_autor integer NOT NULL REFERENCES auth_user(id_user),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(id_oportunidad,id_cliente) REFERENCES crm_oportunidad(id_oportunidad,id_cliente),
  FOREIGN KEY(id_cotizacion,id_cliente) REFERENCES cotizacion(id_cotizacion,id_cliente)
);
CREATE INDEX idx_crm_oportunidad_cotizacion ON crm_oportunidad_cotizacion(id_oportunidad,id_cotizacion);
CREATE TRIGGER trg_audit_jsonb_crm_oportunidad_cotizacion AFTER INSERT OR UPDATE OR DELETE
  ON crm_oportunidad_cotizacion FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
COMMENT ON TABLE crm_oportunidad_cotizacion IS 'Cotización de un único origen CRM confirmado; cliente común exigido por FK y cambios trazados en seguimiento/auditoría';
