-- Contabilidad de doble partida con catálogo, pólizas manuales y pólizas automáticas.
CREATE TABLE IF NOT EXISTS cuenta_contable (
  id_cuenta serial PRIMARY KEY,
  codigo varchar(20) NOT NULL UNIQUE,
  nombre varchar(150) NOT NULL,
  tipo varchar(20) NOT NULL CHECK (tipo IN ('Activo','Pasivo','Capital','Ingreso','Gasto')),
  naturaleza char(1) NOT NULL CHECK (naturaleza IN ('D','A')),
  id_padre integer REFERENCES cuenta_contable(id_cuenta),
  acepta_movimientos boolean NOT NULL DEFAULT true,
  activa boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS poliza_contable (
  id_poliza bigserial PRIMARY KEY,
  folio bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  tipo varchar(10) NOT NULL CHECK (tipo IN ('Diario','Ingreso','Egreso')),
  concepto varchar(300) NOT NULL,
  estado varchar(15) NOT NULL DEFAULT 'Borrador' CHECK (estado IN ('Borrador','Contabilizada','Cancelada')),
  origen_tipo varchar(40),
  origen_id bigint,
  automatica boolean NOT NULL DEFAULT false,
  id_usuario integer REFERENCES auth_user(id_user),
  contabilizada_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((origen_tipo IS NULL AND origen_id IS NULL) OR (origen_tipo IS NOT NULL AND origen_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_poliza_origen ON poliza_contable(origen_tipo,origen_id)
WHERE origen_tipo IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_poliza_fecha_estado ON poliza_contable(fecha DESC,estado);

CREATE TABLE IF NOT EXISTS poliza_contable_detalle (
  id_detalle bigserial PRIMARY KEY,
  id_poliza bigint NOT NULL REFERENCES poliza_contable(id_poliza) ON DELETE CASCADE,
  id_cuenta integer NOT NULL REFERENCES cuenta_contable(id_cuenta),
  concepto varchar(300),
  referencia varchar(120),
  debe numeric(18,2) NOT NULL DEFAULT 0 CHECK (debe >= 0),
  haber numeric(18,2) NOT NULL DEFAULT 0 CHECK (haber >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((debe > 0 AND haber = 0) OR (haber > 0 AND debe = 0))
);
CREATE INDEX IF NOT EXISTS idx_poliza_detalle_poliza ON poliza_contable_detalle(id_poliza);
CREATE INDEX IF NOT EXISTS idx_poliza_detalle_cuenta ON poliza_contable_detalle(id_cuenta);

INSERT INTO cuenta_contable(codigo,nombre,tipo,naturaleza,acepta_movimientos) VALUES
('1000','Activo','Activo','D',false),
('1100','Caja','Activo','D',true),
('1110','Bancos','Activo','D',true),
('1120','Clientes','Activo','D',true),
('1130','Inventarios','Activo','D',true),
('1140','ISR retenido por acreditar','Activo','D',true),
('2000','Pasivo','Pasivo','A',false),
('2100','Proveedores','Pasivo','A',true),
('2200','IVA trasladado','Pasivo','A',true),
('3000','Capital contable','Capital','A',true),
('4000','Ventas','Ingreso','A',true),
('4100','Devoluciones sobre ventas','Ingreso','D',true),
('5000','Costo de ventas','Gasto','D',true),
('6000','Gastos de operación','Gasto','D',true)
ON CONFLICT (codigo) DO UPDATE SET nombre=EXCLUDED.nombre,tipo=EXCLUDED.tipo,naturaleza=EXCLUDED.naturaleza,
  acepta_movimientos=EXCLUDED.acepta_movimientos,activa=true,updated_at=clock_timestamp();

UPDATE cuenta_contable c SET id_padre=p.id_cuenta
FROM cuenta_contable p WHERE
  (c.codigo IN ('1100','1110','1120','1130','1140') AND p.codigo='1000') OR
  (c.codigo IN ('2100','2200') AND p.codigo='2000');

CREATE OR REPLACE FUNCTION fn_cuenta_contable_id(p_codigo text) RETURNS integer
LANGUAGE sql STABLE AS $$ SELECT id_cuenta FROM cuenta_contable WHERE codigo=p_codigo AND activa $$;

CREATE OR REPLACE FUNCTION fn_preparar_poliza_automatica(
  p_origen_tipo text,p_origen_id bigint,p_fecha date,p_tipo text,p_concepto text,p_activa boolean
) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint; v_usuario integer;
BEGIN
  v_usuario:=nullif(current_setting('app.current_user_id',true),'')::integer;
  IF v_usuario IS NOT NULL AND NOT EXISTS(SELECT 1 FROM auth_user WHERE id_user=v_usuario) THEN v_usuario:=NULL; END IF;
  INSERT INTO poliza_contable(fecha,tipo,concepto,estado,origen_tipo,origen_id,automatica,id_usuario,contabilizada_at)
  VALUES(p_fecha,p_tipo,p_concepto,CASE WHEN p_activa THEN 'Contabilizada' ELSE 'Cancelada' END,
    p_origen_tipo,p_origen_id,true,v_usuario,CASE WHEN p_activa THEN clock_timestamp() END)
  ON CONFLICT (origen_tipo,origen_id) WHERE origen_tipo IS NOT NULL DO UPDATE SET
    fecha=EXCLUDED.fecha,tipo=EXCLUDED.tipo,concepto=EXCLUDED.concepto,
    estado=EXCLUDED.estado,id_usuario=coalesce(EXCLUDED.id_usuario,poliza_contable.id_usuario),
    contabilizada_at=EXCLUDED.contabilizada_at,updated_at=clock_timestamp()
  RETURNING id_poliza INTO v_id;
  DELETE FROM poliza_contable_detalle WHERE id_poliza=v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION fn_reconstruir_poliza_factura(p_id integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE f record; v_id bigint; v_costo numeric(18,2); v_ingreso numeric(18,2); v_activa boolean;
BEGIN
  SELECT * INTO f FROM factura WHERE id_factura=p_id;
  IF NOT FOUND THEN RETURN; END IF;
  v_activa:=f.estatus::text <> 'Cancelada';
  v_id:=fn_preparar_poliza_automatica('Factura',p_id,f.fecha_emision::date,'Diario',
    'Factura '||coalesce(f.serie,'')||'-'||coalesce(f.folio::text,p_id::text),v_activa);
  IF NOT v_activa THEN RETURN; END IF;
  -- Se deriva del total fiscal para conservar el centavo de redondeo del CFDI.
  v_ingreso:=greatest(0,coalesce(f.total,0)+coalesce(f.total_impuestos_retenidos,0)-coalesce(f.total_impuestos_trasladados,0));
  SELECT coalesce(sum(cantidad*coalesce(costo_unitario_snapshot,0)),0) INTO v_costo FROM conceptofactura WHERE id_factura=p_id;
  IF coalesce(f.tipo_comprobante,'I')='E' THEN
    INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe)
      SELECT v_id,fn_cuenta_contable_id('4100'),'Nota de crédito',v_ingreso WHERE v_ingreso>0;
    INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe)
      SELECT v_id,fn_cuenta_contable_id('2200'),'IVA devuelto',coalesce(f.total_impuestos_trasladados,0) WHERE coalesce(f.total_impuestos_trasladados,0)>0;
    INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber)
      SELECT v_id,fn_cuenta_contable_id('1120'),'Disminución de saldo del cliente',coalesce(f.total,0) WHERE coalesce(f.total,0)>0;
    INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber)
      SELECT v_id,fn_cuenta_contable_id('1140'),'Reverso de retención',coalesce(f.total_impuestos_retenidos,0) WHERE coalesce(f.total_impuestos_retenidos,0)>0;
    IF v_costo>0 THEN
      INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES(v_id,fn_cuenta_contable_id('1130'),'Retorno a inventario',v_costo);
      INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES(v_id,fn_cuenta_contable_id('5000'),'Reverso de costo',v_costo);
    END IF;
  ELSE
    INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe)
      SELECT v_id,fn_cuenta_contable_id('1120'),'Cuenta por cobrar',coalesce(f.total,0) WHERE coalesce(f.total,0)>0;
    INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe)
      SELECT v_id,fn_cuenta_contable_id('1140'),'ISR retenido',coalesce(f.total_impuestos_retenidos,0) WHERE coalesce(f.total_impuestos_retenidos,0)>0;
    INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber)
      SELECT v_id,fn_cuenta_contable_id('4000'),'Venta',v_ingreso WHERE v_ingreso>0;
    INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber)
      SELECT v_id,fn_cuenta_contable_id('2200'),'IVA trasladado',coalesce(f.total_impuestos_trasladados,0) WHERE coalesce(f.total_impuestos_trasladados,0)>0;
    IF v_costo>0 THEN
      INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES(v_id,fn_cuenta_contable_id('5000'),'Costo de venta',v_costo);
      INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES(v_id,fn_cuenta_contable_id('1130'),'Salida de inventario',v_costo);
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_reconstruir_poliza_pago(p_id integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p record; v_id bigint;
BEGIN
  SELECT * INTO p FROM pago WHERE id_pago=p_id; IF NOT FOUND THEN RETURN; END IF;
  v_id:=fn_preparar_poliza_automatica('PagoCliente',p_id,p.fecha_pago::date,'Ingreso','Cobro de factura '||p.id_factura,true);
  INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES
    (v_id,fn_cuenta_contable_id(CASE WHEN p.forma_pago ILIKE '%Efectivo%' THEN '1100' ELSE '1110' END),'Cobro recibido',p.monto);
  INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES(v_id,fn_cuenta_contable_id('1120'),'Aplicación a cliente',p.monto);
END $$;

CREATE OR REPLACE FUNCTION fn_reconstruir_poliza_compra(p_id integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c record; v_id bigint; v_total numeric(18,2); v_activa boolean;
BEGIN
  SELECT * INTO c FROM compra WHERE id_compra=p_id; IF NOT FOUND THEN RETURN; END IF;
  v_activa:=c.estatus::text NOT IN ('Cancelada','Cancelado');
  v_id:=fn_preparar_poliza_automatica('Compra',p_id,c.fecha_compra::date,'Diario','Compra '||coalesce(c.folio_factura_proveedor,p_id::text),v_activa);
  IF NOT v_activa THEN RETURN; END IF;
  SELECT coalesce(sum(importe),c.total,0) INTO v_total FROM detalle_compra WHERE id_compra=p_id;
  IF v_total>0 THEN
    INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES(v_id,fn_cuenta_contable_id('1130'),'Entrada de inventario',v_total);
    INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES(v_id,fn_cuenta_contable_id('2100'),'Cuenta por pagar',v_total);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_reconstruir_poliza_pago_proveedor(p_id integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p record; v_id bigint;
BEGIN
  SELECT * INTO p FROM pago_proveedor WHERE id_pago_proveedor=p_id; IF NOT FOUND THEN RETURN; END IF;
  v_id:=fn_preparar_poliza_automatica('PagoProveedor',p_id,p.fecha_pago::date,'Egreso','Pago de compra '||p.id_compra,true);
  INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES(v_id,fn_cuenta_contable_id('2100'),'Aplicación a proveedor',p.monto);
  INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES
    (v_id,fn_cuenta_contable_id(CASE WHEN p.forma_pago ILIKE '%Efectivo%' THEN '1100' ELSE '1110' END),'Salida de fondos',p.monto);
END $$;

CREATE OR REPLACE FUNCTION fn_reconstruir_poliza_gasto(p_id integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE g record; v_id bigint;
BEGIN
  SELECT * INTO g FROM gasto WHERE id_gasto=p_id; IF NOT FOUND THEN RETURN; END IF;
  v_id:=fn_preparar_poliza_automatica('Gasto',p_id,g.fecha::date,'Egreso',g.concepto,NOT coalesce(g.anulado,false));
  IF coalesce(g.anulado,false) THEN RETURN; END IF;
  INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES(v_id,fn_cuenta_contable_id('6000'),g.categoria,g.monto);
  INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES
    (v_id,fn_cuenta_contable_id(CASE WHEN g.metodo_pago ILIKE '%Efectivo%' THEN '1100' ELSE '1110' END),'Pago del gasto',g.monto);
END $$;

CREATE OR REPLACE FUNCTION fn_sync_poliza_factura() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM fn_reconstruir_poliza_factura(coalesce(NEW.id_factura,OLD.id_factura)); RETURN coalesce(NEW,OLD); END $$;
CREATE OR REPLACE FUNCTION fn_sync_poliza_concepto() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM fn_reconstruir_poliza_factura(coalesce(NEW.id_factura,OLD.id_factura)); RETURN coalesce(NEW,OLD); END $$;
CREATE OR REPLACE FUNCTION fn_sync_poliza_compra() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM fn_reconstruir_poliza_compra(coalesce(NEW.id_compra,OLD.id_compra)); RETURN coalesce(NEW,OLD); END $$;
CREATE OR REPLACE FUNCTION fn_sync_poliza_detalle_compra() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM fn_reconstruir_poliza_compra(coalesce(NEW.id_compra,OLD.id_compra)); RETURN coalesce(NEW,OLD); END $$;
CREATE OR REPLACE FUNCTION fn_sync_poliza_pago() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM fn_reconstruir_poliza_pago(coalesce(NEW.id_pago,OLD.id_pago)); RETURN coalesce(NEW,OLD); END $$;
CREATE OR REPLACE FUNCTION fn_sync_poliza_pago_proveedor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM fn_reconstruir_poliza_pago_proveedor(coalesce(NEW.id_pago_proveedor,OLD.id_pago_proveedor)); RETURN coalesce(NEW,OLD); END $$;
CREATE OR REPLACE FUNCTION fn_sync_poliza_gasto() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM fn_reconstruir_poliza_gasto(coalesce(NEW.id_gasto,OLD.id_gasto)); RETURN coalesce(NEW,OLD); END $$;

DROP TRIGGER IF EXISTS trg_sync_poliza_factura ON factura;
CREATE TRIGGER trg_sync_poliza_factura AFTER INSERT OR UPDATE OF estatus,subtotal,descuento,total_impuestos_trasladados,total_impuestos_retenidos,total ON factura FOR EACH ROW EXECUTE FUNCTION fn_sync_poliza_factura();
DROP TRIGGER IF EXISTS trg_sync_poliza_concepto ON conceptofactura;
CREATE TRIGGER trg_sync_poliza_concepto AFTER INSERT OR UPDATE OR DELETE ON conceptofactura FOR EACH ROW EXECUTE FUNCTION fn_sync_poliza_concepto();
DROP TRIGGER IF EXISTS trg_sync_poliza_compra ON compra;
CREATE TRIGGER trg_sync_poliza_compra AFTER INSERT OR UPDATE OF estatus,total ON compra FOR EACH ROW EXECUTE FUNCTION fn_sync_poliza_compra();
DROP TRIGGER IF EXISTS trg_sync_poliza_detalle_compra ON detalle_compra;
CREATE TRIGGER trg_sync_poliza_detalle_compra AFTER INSERT OR UPDATE OR DELETE ON detalle_compra FOR EACH ROW EXECUTE FUNCTION fn_sync_poliza_detalle_compra();
DROP TRIGGER IF EXISTS trg_sync_poliza_pago ON pago;
CREATE TRIGGER trg_sync_poliza_pago AFTER INSERT OR UPDATE ON pago FOR EACH ROW EXECUTE FUNCTION fn_sync_poliza_pago();
DROP TRIGGER IF EXISTS trg_sync_poliza_pago_proveedor ON pago_proveedor;
CREATE TRIGGER trg_sync_poliza_pago_proveedor AFTER INSERT OR UPDATE ON pago_proveedor FOR EACH ROW EXECUTE FUNCTION fn_sync_poliza_pago_proveedor();
DROP TRIGGER IF EXISTS trg_sync_poliza_gasto ON gasto;
CREATE TRIGGER trg_sync_poliza_gasto AFTER INSERT OR UPDATE ON gasto FOR EACH ROW EXECUTE FUNCTION fn_sync_poliza_gasto();

-- Reconstrucción inicial desde documentos existentes; no inventa saldos de apertura.
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT id_factura FROM factura LOOP PERFORM fn_reconstruir_poliza_factura(r.id_factura); END LOOP;
  FOR r IN SELECT id_pago FROM pago LOOP PERFORM fn_reconstruir_poliza_pago(r.id_pago); END LOOP;
  FOR r IN SELECT id_compra FROM compra LOOP PERFORM fn_reconstruir_poliza_compra(r.id_compra); END LOOP;
  FOR r IN SELECT id_pago_proveedor FROM pago_proveedor LOOP PERFORM fn_reconstruir_poliza_pago_proveedor(r.id_pago_proveedor); END LOOP;
  FOR r IN SELECT id_gasto FROM gasto LOOP PERFORM fn_reconstruir_poliza_gasto(r.id_gasto); END LOOP;
END $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['cuenta_contable','poliza_contable','poliza_contable_detalle'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_jsonb_%I ON %I',t,t);
    EXECUTE format('CREATE TRIGGER trg_audit_jsonb_%I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger()',t,t);
  END LOOP;
END $$;
