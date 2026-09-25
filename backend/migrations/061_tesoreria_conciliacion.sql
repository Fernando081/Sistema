-- Tesorería: cuentas propias, estado de cuenta y conciliación con movimientos del sistema.
CREATE TABLE IF NOT EXISTS tesoreria_cuenta (
  id_cuenta serial PRIMARY KEY,
  nombre varchar(100) NOT NULL,
  banco varchar(100) NOT NULL,
  moneda char(3) NOT NULL DEFAULT 'MXN',
  ultimos_cuatro char(4),
  saldo_inicial numeric(18,2) NOT NULL DEFAULT 0,
  activa boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (ultimos_cuatro IS NULL OR ultimos_cuatro ~ '^[0-9]{4}$')
);

CREATE TABLE IF NOT EXISTS tesoreria_movimiento (
  id_movimiento bigserial PRIMARY KEY,
  id_cuenta integer NOT NULL REFERENCES tesoreria_cuenta(id_cuenta),
  fecha date NOT NULL,
  descripcion varchar(300) NOT NULL,
  referencia varchar(120),
  monto numeric(18,2) NOT NULL CHECK (monto <> 0),
  estado varchar(12) NOT NULL DEFAULT 'Pendiente' CHECK (estado IN ('Pendiente','Conciliado')),
  id_caja_movimiento bigint UNIQUE REFERENCES caja_movimiento(id_movimiento),
  conciliado_por integer REFERENCES auth_user(id_user),
  conciliado_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((estado='Pendiente' AND id_caja_movimiento IS NULL AND conciliado_at IS NULL)
    OR (estado='Conciliado' AND id_caja_movimiento IS NOT NULL AND conciliado_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_tesoreria_movimiento_busqueda ON tesoreria_movimiento(id_cuenta,estado,fecha DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tesoreria_movimiento_referencia ON tesoreria_movimiento(id_cuenta,referencia)
WHERE referencia IS NOT NULL AND referencia<>'';

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['tesoreria_cuenta','tesoreria_movimiento'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_jsonb_%I ON %I',t,t);
    EXECUTE format('CREATE TRIGGER trg_audit_jsonb_%I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger()',t,t);
  END LOOP;
END $$;
