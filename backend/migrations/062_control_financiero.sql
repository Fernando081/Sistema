-- Cierre de la fase financiera: periodos, centros de costo y presupuestos.
CREATE TABLE periodo_contable (
  id_periodo serial PRIMARY KEY,
  anio integer NOT NULL CHECK(anio BETWEEN 2000 AND 2200),
  mes integer NOT NULL CHECK(mes BETWEEN 1 AND 12),
  fecha_inicio date GENERATED ALWAYS AS (make_date(anio,mes,1)) STORED,
  fecha_fin date GENERATED ALWAYS AS ((make_date(anio,mes,1)+interval '1 month'-interval '1 day')::date) STORED,
  estado varchar(10) NOT NULL DEFAULT 'Abierto' CHECK(estado IN ('Abierto','Cerrado')),
  cerrado_por integer REFERENCES auth_user(id_user),
  cerrado_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(anio,mes),
  CHECK((estado='Abierto' AND cerrado_at IS NULL) OR (estado='Cerrado' AND cerrado_at IS NOT NULL AND cerrado_por IS NOT NULL))
);

CREATE TABLE centro_costo (
  id_centro serial PRIMARY KEY,
  codigo varchar(20) NOT NULL UNIQUE,
  nombre varchar(120) NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO centro_costo(codigo,nombre) VALUES('GENERAL','Operación general') ON CONFLICT(codigo) DO NOTHING;

ALTER TABLE poliza_contable_detalle ADD COLUMN id_centro_costo integer REFERENCES centro_costo(id_centro);
UPDATE poliza_contable_detalle SET id_centro_costo=(SELECT id_centro FROM centro_costo WHERE codigo='GENERAL') WHERE id_centro_costo IS NULL;
ALTER TABLE poliza_contable_detalle ALTER COLUMN id_centro_costo SET NOT NULL;
CREATE OR REPLACE FUNCTION fn_centro_general() RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT id_centro FROM centro_costo WHERE codigo='GENERAL'
$$;
ALTER TABLE poliza_contable_detalle ALTER COLUMN id_centro_costo SET DEFAULT fn_centro_general();
CREATE INDEX idx_poliza_detalle_centro ON poliza_contable_detalle(id_centro_costo);

CREATE TABLE presupuesto_contable (
  id_presupuesto bigserial PRIMARY KEY,
  anio integer NOT NULL CHECK(anio BETWEEN 2000 AND 2200),
  mes integer NOT NULL CHECK(mes BETWEEN 1 AND 12),
  id_cuenta integer NOT NULL REFERENCES cuenta_contable(id_cuenta),
  id_centro_costo integer REFERENCES centro_costo(id_centro),
  monto numeric(18,2) NOT NULL CHECK(monto>=0),
  notas varchar(500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX uq_presupuesto_general ON presupuesto_contable(anio,mes,id_cuenta) WHERE id_centro_costo IS NULL;
CREATE UNIQUE INDEX uq_presupuesto_centro ON presupuesto_contable(anio,mes,id_cuenta,id_centro_costo) WHERE id_centro_costo IS NOT NULL;

CREATE OR REPLACE FUNCTION fn_bloquear_periodo_cerrado() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_fecha date;
BEGIN
  v_fecha:=coalesce(NEW.fecha,OLD.fecha);
  IF EXISTS(SELECT 1 FROM periodo_contable WHERE estado='Cerrado' AND v_fecha BETWEEN fecha_inicio AND fecha_fin) THEN
    RAISE EXCEPTION 'El periodo contable de % está cerrado',to_char(v_fecha,'MM/YYYY') USING ERRCODE='23514';
  END IF;
  RETURN coalesce(NEW,OLD);
END $$;
DROP TRIGGER IF EXISTS trg_bloquear_periodo_cerrado ON poliza_contable;
CREATE TRIGGER trg_bloquear_periodo_cerrado BEFORE INSERT OR UPDATE OR DELETE ON poliza_contable
FOR EACH ROW EXECUTE FUNCTION fn_bloquear_periodo_cerrado();

CREATE OR REPLACE FUNCTION fn_bloquear_detalle_periodo_cerrado() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_poliza bigint; v_fecha date;
BEGIN
  v_poliza:=coalesce(NEW.id_poliza,OLD.id_poliza);
  SELECT fecha INTO v_fecha FROM poliza_contable WHERE id_poliza=v_poliza;
  IF EXISTS(SELECT 1 FROM periodo_contable WHERE estado='Cerrado' AND v_fecha BETWEEN fecha_inicio AND fecha_fin) THEN
    RAISE EXCEPTION 'El periodo contable de % está cerrado',to_char(v_fecha,'MM/YYYY') USING ERRCODE='23514';
  END IF;
  RETURN coalesce(NEW,OLD);
END $$;
DROP TRIGGER IF EXISTS trg_bloquear_detalle_periodo_cerrado ON poliza_contable_detalle;
CREATE TRIGGER trg_bloquear_detalle_periodo_cerrado BEFORE INSERT OR UPDATE OR DELETE ON poliza_contable_detalle
FOR EACH ROW EXECUTE FUNCTION fn_bloquear_detalle_periodo_cerrado();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['periodo_contable','centro_costo','presupuesto_contable'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_jsonb_%I ON %I',t,t);
    EXECUTE format('CREATE TRIGGER trg_audit_jsonb_%I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger()',t,t);
  END LOOP;
END $$;
