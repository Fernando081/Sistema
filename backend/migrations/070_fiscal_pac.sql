-- Ciclo de vida fiscal independiente de la operación interna.
-- Los secretos del PAC y del CSD nunca se almacenan en PostgreSQL.
CREATE TABLE IF NOT EXISTS fiscal_documento (
  id_documento bigserial PRIMARY KEY,
  tipo varchar(12) NOT NULL CHECK (tipo IN ('FACTURA','REP')),
  id_factura integer REFERENCES factura(id_factura) ON DELETE RESTRICT,
  id_rep integer REFERENCES rep(id_rep) ON DELETE RESTRICT,
  proveedor varchar(30) NOT NULL,
  ambiente varchar(15) NOT NULL CHECK (ambiente IN ('mock','sandbox','production')),
  estado varchar(30) NOT NULL DEFAULT 'Borrador'
    CHECK (estado IN ('Borrador','Procesando','Timbrado','Cancelacion solicitada','Cancelado','Error')),
  uuid uuid,
  xml_timbrado text,
  acuse_cancelacion text,
  fecha_timbrado timestamptz,
  fecha_cancelacion timestamptz,
  no_certificado_sat varchar(40),
  no_certificado_cfdi varchar(40),
  sello_sat text,
  sello_cfdi text,
  cadena_original_sat text,
  motivo_cancelacion char(2),
  folio_sustitucion uuid,
  codigo_cancelacion varchar(20),
  mensaje_cancelacion text,
  ultimo_error text,
  intentos integer NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  id_user integer REFERENCES auth_user(id_user) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fiscal_documento_origen_chk CHECK (
    (tipo='FACTURA' AND id_factura IS NOT NULL AND id_rep IS NULL) OR
    (tipo='REP' AND id_rep IS NOT NULL AND id_factura IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_fiscal_documento_factura
  ON fiscal_documento(id_factura) WHERE id_factura IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_fiscal_documento_rep
  ON fiscal_documento(id_rep) WHERE id_rep IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_fiscal_documento_uuid
  ON fiscal_documento(uuid) WHERE uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fiscal_documento_estado
  ON fiscal_documento(estado, updated_at DESC);

CREATE TABLE IF NOT EXISTS fiscal_evento (
  id_evento bigserial PRIMARY KEY,
  id_documento bigint NOT NULL REFERENCES fiscal_documento(id_documento) ON DELETE CASCADE,
  tipo varchar(40) NOT NULL,
  exito boolean NOT NULL,
  codigo varchar(80),
  mensaje text,
  detalle jsonb NOT NULL DEFAULT '{}'::jsonb,
  id_user integer REFERENCES auth_user(id_user) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_fiscal_evento_documento
  ON fiscal_evento(id_documento, created_at DESC);

COMMENT ON TABLE fiscal_documento IS
  'Estado fiscal autoritativo, XML timbrado y acuse. Las facturas y REP conservan su ciclo operativo por separado.';
COMMENT ON COLUMN fiscal_documento.xml_timbrado IS
  'XML fiscal devuelto por el PAC. Debe incluirse en respaldos protegidos.';
COMMENT ON TABLE fiscal_evento IS
  'Bitácora sin secretos de intentos de timbrado, cancelación y conciliación.';

-- Los UUID ficticios creados por el modo histórico de REP no se consideran timbres.
-- Los nuevos REP empiezan como borradores; el PAC asigna el UUID al timbrar.
