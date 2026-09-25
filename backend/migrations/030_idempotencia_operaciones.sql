-- 030_idempotencia_operaciones.sql
-- Evita duplicar operaciones cuando el cliente reintenta tras un timeout.

CREATE TABLE IF NOT EXISTS operation_idempotency (
  request_id uuid PRIMARY KEY,
  operation_type varchar(30) NOT NULL,
  id_user integer NULL REFERENCES auth_user(id_user) ON DELETE SET NULL,
  payload_hash char(64) NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_operation_idempotency_created_at
  ON operation_idempotency (created_at);

COMMENT ON TABLE operation_idempotency IS
  'Resultados de operaciones críticas identificadas por UUID para responder reintentos sin duplicar efectos.';
