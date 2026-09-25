-- Vincula cada autorización comercial con la operación que la consumió.

ALTER TABLE solicitud_autorizacion_comercial
  ADD COLUMN IF NOT EXISTS operacion_tipo varchar(30) NULL,
  ADD COLUMN IF NOT EXISTS operacion_id bigint NULL,
  ADD COLUMN IF NOT EXISTS used_at timestamptz NULL;

ALTER TABLE solicitud_autorizacion_comercial
  DROP CONSTRAINT IF EXISTS chk_autorizacion_operacion;
ALTER TABLE solicitud_autorizacion_comercial
  ADD CONSTRAINT chk_autorizacion_operacion CHECK (
    (estado = 'Utilizada' AND operacion_tipo IS NOT NULL AND operacion_id IS NOT NULL AND used_at IS NOT NULL)
    OR estado <> 'Utilizada'
  );

CREATE INDEX IF NOT EXISTS idx_autorizacion_comercial_busqueda
  ON solicitud_autorizacion_comercial(id_cliente,tipo,id_producto,estado,expires_at);

COMMENT ON COLUMN solicitud_autorizacion_comercial.operacion_tipo IS
'Entidad que consumió la autorización: Venta, Pedido o Cotizacion.';
