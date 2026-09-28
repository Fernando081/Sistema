-- Conciliación local avanzada: agrupaciones, ajustes, transferencias y cierres.
-- No conecta ni intercambia información con ninguna institución bancaria.
CREATE TABLE tesoreria_conciliacion (
  id_conciliacion bigserial PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  id_cuenta integer REFERENCES tesoreria_cuenta(id_cuenta),
  tipo varchar(15) NOT NULL CHECK(tipo IN('Exacta','Ajuste','Transferencia')),
  estado varchar(12) NOT NULL DEFAULT 'Activa' CHECK(estado IN('Activa','Revertida')),
  total_banco numeric(18,2) NOT NULL,
  total_sistema numeric(18,2) NOT NULL,
  ajuste numeric(18,2) NOT NULL DEFAULT 0,
  tipo_ajuste varchar(20) CHECK(tipo_ajuste IS NULL OR tipo_ajuste IN('Comision','Redondeo','TipoCambio','Otro')),
  motivo varchar(500),
  id_usuario integer REFERENCES auth_user(id_user) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revertida_por integer REFERENCES auth_user(id_user) ON DELETE SET NULL,
  revertida_at timestamptz,
  motivo_reversion varchar(500),
  CHECK(total_banco=total_sistema+ajuste),
  CHECK((estado='Activa' AND revertida_at IS NULL) OR (estado='Revertida' AND revertida_at IS NOT NULL))
);

ALTER TABLE tesoreria_movimiento ADD COLUMN id_conciliacion bigint REFERENCES tesoreria_conciliacion(id_conciliacion);
ALTER TABLE tesoreria_movimiento DROP CONSTRAINT IF EXISTS tesoreria_movimiento_vinculo_check;
ALTER TABLE tesoreria_movimiento DROP CONSTRAINT IF EXISTS tesoreria_movimiento_id_caja_movimiento_key;

CREATE TABLE tesoreria_conciliacion_sistema (
  id_conciliacion bigint NOT NULL REFERENCES tesoreria_conciliacion(id_conciliacion) ON DELETE CASCADE,
  id_caja_movimiento bigint NOT NULL REFERENCES caja_movimiento(id_movimiento),
  monto numeric(18,2) NOT NULL,
  generado_ajuste boolean NOT NULL DEFAULT false,
  PRIMARY KEY(id_conciliacion,id_caja_movimiento),
  UNIQUE(id_caja_movimiento)
);

DO $$ DECLARE r record; v_id bigint; BEGIN
  FOR r IN SELECT * FROM tesoreria_movimiento WHERE estado='Conciliado' AND id_caja_movimiento IS NOT NULL LOOP
    INSERT INTO tesoreria_conciliacion(request_id,id_cuenta,tipo,total_banco,total_sistema,ajuste,motivo,created_at)
    VALUES(md5('legacy-bank-reconciliation:'||r.id_movimiento)::uuid,r.id_cuenta,'Exacta',r.monto,r.monto,0,'Migración de conciliación anterior',coalesce(r.conciliado_at,r.created_at))
    RETURNING id_conciliacion INTO v_id;
    INSERT INTO tesoreria_conciliacion_sistema(id_conciliacion,id_caja_movimiento,monto)
    VALUES(v_id,r.id_caja_movimiento,r.monto);
    UPDATE tesoreria_movimiento SET id_conciliacion=v_id,id_caja_movimiento=NULL WHERE id_movimiento=r.id_movimiento;
  END LOOP;
END $$;

ALTER TABLE tesoreria_movimiento ADD CONSTRAINT tesoreria_movimiento_vinculo_check CHECK(
  (estado IN('Pendiente','Ignorado') AND id_conciliacion IS NULL AND conciliado_at IS NULL) OR
  (estado='Conciliado' AND id_conciliacion IS NOT NULL AND conciliado_at IS NOT NULL)
);
CREATE INDEX idx_tesoreria_movimiento_conciliacion ON tesoreria_movimiento(id_conciliacion) WHERE id_conciliacion IS NOT NULL;

CREATE TABLE tesoreria_transferencia (
  id_transferencia bigserial PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  id_conciliacion bigint NOT NULL UNIQUE REFERENCES tesoreria_conciliacion(id_conciliacion),
  id_movimiento_salida bigint NOT NULL REFERENCES tesoreria_movimiento(id_movimiento),
  id_movimiento_entrada bigint NOT NULL REFERENCES tesoreria_movimiento(id_movimiento),
  referencia varchar(120),
  id_usuario integer REFERENCES auth_user(id_user) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(id_movimiento_salida<>id_movimiento_entrada)
);

CREATE TABLE tesoreria_cierre (
  id_cierre bigserial PRIMARY KEY,
  id_cuenta integer NOT NULL REFERENCES tesoreria_cuenta(id_cuenta),
  anio integer NOT NULL CHECK(anio BETWEEN 2000 AND 2200),
  mes integer NOT NULL CHECK(mes BETWEEN 1 AND 12),
  saldo_estado_cuenta numeric(18,2) NOT NULL,
  saldo_calculado numeric(18,2) NOT NULL,
  movimientos integer NOT NULL,
  conciliados integer NOT NULL,
  ignorados integer NOT NULL,
  id_usuario integer NOT NULL REFERENCES auth_user(id_user),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(id_cuenta,anio,mes),
  CHECK(saldo_estado_cuenta=saldo_calculado)
);

CREATE OR REPLACE FUNCTION fn_bloquear_tesoreria_cerrada() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_cuenta integer;v_fecha date;
BEGIN
  v_cuenta:=coalesce(NEW.id_cuenta,OLD.id_cuenta);v_fecha:=coalesce(NEW.fecha,OLD.fecha);
  IF EXISTS(SELECT 1 FROM tesoreria_cierre WHERE id_cuenta=v_cuenta
    AND (make_date(anio,mes,1)+interval '1 month-1 day')::date>=v_fecha) THEN
    RAISE EXCEPTION 'Tesorería está cerrada hasta una fecha posterior o igual a %',to_char(v_fecha,'DD/MM/YYYY') USING ERRCODE='23514';
  END IF;
  RETURN coalesce(NEW,OLD);
END $$;
DROP TRIGGER IF EXISTS trg_bloquear_tesoreria_cerrada ON tesoreria_movimiento;
CREATE TRIGGER trg_bloquear_tesoreria_cerrada BEFORE INSERT OR UPDATE OR DELETE ON tesoreria_movimiento
FOR EACH ROW EXECUTE FUNCTION fn_bloquear_tesoreria_cerrada();

INSERT INTO cuenta_contable(codigo,nombre,tipo,naturaleza,acepta_movimientos) VALUES
('6010','Comisiones bancarias','Gasto','D',true),
('6020','Pérdida cambiaria','Gasto','D',true),
('4090','Otros ingresos bancarios','Ingreso','A',true)
ON CONFLICT(codigo) DO UPDATE SET nombre=excluded.nombre,activa=true,updated_at=clock_timestamp();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['tesoreria_conciliacion','tesoreria_conciliacion_sistema','tesoreria_transferencia','tesoreria_cierre'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_jsonb_%I ON %I',t,t);
    EXECUTE format('CREATE TRIGGER trg_audit_jsonb_%I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger()',t,t);
  END LOOP;
END $$;
