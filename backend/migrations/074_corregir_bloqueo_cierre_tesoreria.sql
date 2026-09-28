-- Corrige el cálculo del último día cerrado sin alterar la migración ya aplicada.
CREATE OR REPLACE FUNCTION fn_bloquear_tesoreria_cerrada() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_cuenta integer;v_fecha date;
BEGIN
  v_cuenta:=coalesce(NEW.id_cuenta,OLD.id_cuenta);v_fecha:=coalesce(NEW.fecha,OLD.fecha);
  IF EXISTS(SELECT 1 FROM tesoreria_cierre WHERE id_cuenta=v_cuenta
    AND (make_date(anio,mes,1)+interval '1 month'-interval '1 day')::date>=v_fecha) THEN
    RAISE EXCEPTION 'Tesorería está cerrada hasta una fecha posterior o igual a %',to_char(v_fecha,'DD/MM/YYYY') USING ERRCODE='23514';
  END IF;
  RETURN coalesce(NEW,OLD);
END $$;
