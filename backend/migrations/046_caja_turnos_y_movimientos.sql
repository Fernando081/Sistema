-- Caja general: turnos y bitácora de variaciones desde esta migración.
-- No reconstruye ni inventa movimientos de efectivo anteriores.
CREATE TABLE caja_movimiento (
  id_movimiento bigserial PRIMARY KEY,
  id_saldo integer NOT NULL,
  fecha timestamptz NOT NULL DEFAULT clock_timestamp(),
  efectivo numeric(18,2) NOT NULL,
  banco numeric(18,2) NOT NULL,
  saldo_efectivo numeric(18,2) NOT NULL,
  saldo_banco numeric(18,2) NOT NULL,
  id_usuario integer REFERENCES auth_user(id_user),
  origen text NOT NULL DEFAULT 'Movimiento del sistema'
);
CREATE INDEX idx_caja_movimiento_fecha ON caja_movimiento(fecha DESC);

CREATE OR REPLACE FUNCTION fn_registrar_movimiento_caja()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_usuario integer;
BEGIN
  IF NEW.caja_chica IS NOT DISTINCT FROM OLD.caja_chica AND NEW.cuenta_banco IS NOT DISTINCT FROM OLD.cuenta_banco THEN RETURN NEW; END IF;
  v_usuario := nullif(current_setting('app.current_user_id',true),'')::integer;
  IF v_usuario IS NOT NULL AND NOT EXISTS(SELECT 1 FROM auth_user WHERE id_user=v_usuario) THEN v_usuario:=NULL; END IF;
  INSERT INTO caja_movimiento(id_saldo,efectivo,banco,saldo_efectivo,saldo_banco,id_usuario,origen)
  VALUES(NEW.id_saldo,NEW.caja_chica-OLD.caja_chica,NEW.cuenta_banco-OLD.cuenta_banco,
         NEW.caja_chica,NEW.cuenta_banco,v_usuario,
         coalesce(nullif(current_setting('app.movement_origin',true),''),'Movimiento del sistema'));
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_registrar_movimiento_caja AFTER UPDATE ON saldos
FOR EACH ROW EXECUTE FUNCTION fn_registrar_movimiento_caja();

CREATE TABLE caja_turno (
  id_turno serial PRIMARY KEY,
  apertura timestamptz NOT NULL DEFAULT clock_timestamp(),
  cierre timestamptz,
  abierto_por integer NOT NULL REFERENCES auth_user(id_user),
  cerrado_por integer REFERENCES auth_user(id_user),
  estado varchar(10) NOT NULL DEFAULT 'Abierta' CHECK(estado IN ('Abierta','Cerrada')),
  contado_apertura numeric(18,2) NOT NULL CHECK(contado_apertura>=0),
  saldo_sistema_apertura numeric(18,2) NOT NULL,
  id_movimiento_inicio bigint NOT NULL,
  id_movimiento_fin bigint,
  esperado_cierre numeric(18,2),
  contado_cierre numeric(18,2) CHECK(contado_cierre>=0),
  diferencia numeric(18,2),
  notas_apertura varchar(1000),
  notas_cierre varchar(1000),
  CHECK ((estado='Abierta' AND cierre IS NULL AND contado_cierre IS NULL)
    OR (estado='Cerrada' AND cierre IS NOT NULL AND contado_cierre IS NOT NULL AND cerrado_por IS NOT NULL))
);
CREATE UNIQUE INDEX caja_un_turno_abierto ON caja_turno ((estado)) WHERE estado='Abierta';
CREATE INDEX idx_caja_turno_apertura ON caja_turno(apertura DESC);

CREATE OR REPLACE FUNCTION fn_proteger_bitacora_caja()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'La bitácora de caja es inmutable; registra un movimiento compensatorio'; END;
$$;
CREATE TRIGGER trg_proteger_bitacora_caja BEFORE UPDATE OR DELETE ON caja_movimiento
FOR EACH ROW EXECUTE FUNCTION fn_proteger_bitacora_caja();
