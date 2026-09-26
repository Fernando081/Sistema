-- Facturas de proveedor, conciliacion de tres vias y cuentas por pagar.
-- La recepcion es la unica que mueve inventario; la factura reconoce la deuda.

CREATE TABLE IF NOT EXISTS factura_proveedor (
  id_factura_proveedor bigserial PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  id_proveedor integer NOT NULL REFERENCES proveedor("IdProveedor"),
  id_orden integer NOT NULL REFERENCES orden_compra(id_orden),
  serie varchar(30), folio varchar(80) NOT NULL, uuid uuid,
  fecha_emision date NOT NULL, fecha_recepcion date NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento date NOT NULL, moneda varchar(3) NOT NULL DEFAULT 'MXN',
  tipo_cambio numeric(18,6) NOT NULL DEFAULT 1 CHECK(tipo_cambio>0),
  subtotal numeric(18,2) NOT NULL CHECK(subtotal>=0),
  impuestos numeric(18,2) NOT NULL DEFAULT 0 CHECK(impuestos>=0),
  retenciones numeric(18,2) NOT NULL DEFAULT 0 CHECK(retenciones>=0),
  total numeric(18,2) NOT NULL CHECK(total>0),
  saldo_pendiente numeric(18,2) NOT NULL CHECK(saldo_pendiente>=0),
  estado varchar(30) NOT NULL DEFAULT 'Por conciliar' CHECK(estado IN
    ('Por conciliar','Con discrepancias','Conciliada','Aprobada','Parcialmente pagada','Pagada','Cancelada')),
  xml_original text, pdf_original bytea, pdf_mime varchar(80),
  xml_sha256 char(64), pdf_sha256 char(64), observaciones varchar(1000),
  id_user integer REFERENCES auth_user(id_user) ON DELETE SET NULL,
  aprobada_por integer REFERENCES auth_user(id_user) ON DELETE SET NULL,
  aprobada_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_factura_proveedor_uuid ON factura_proveedor(uuid) WHERE uuid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_factura_proveedor_folio ON factura_proveedor
  (id_proveedor,lower(coalesce(serie,'')),lower(folio)) WHERE estado<>'Cancelada';
CREATE INDEX IF NOT EXISTS idx_factura_proveedor_saldo ON factura_proveedor(fecha_vencimiento,id_proveedor)
  WHERE saldo_pendiente>0 AND estado IN ('Aprobada','Parcialmente pagada');

CREATE TABLE IF NOT EXISTS factura_proveedor_detalle (
  id_detalle bigserial PRIMARY KEY,
  id_factura_proveedor bigint NOT NULL REFERENCES factura_proveedor(id_factura_proveedor) ON DELETE CASCADE,
  id_orden_detalle integer NOT NULL REFERENCES orden_compra_detalle(id_detalle),
  id_producto integer NOT NULL REFERENCES producto("IdProducto"), descripcion varchar(500) NOT NULL,
  cantidad numeric(18,6) NOT NULL CHECK(cantidad>0), costo_unitario numeric(18,6) NOT NULL CHECK(costo_unitario>=0),
  tasa_iva numeric(9,6) NOT NULL DEFAULT 0 CHECK(tasa_iva>=0),
  importe numeric(18,2) NOT NULL CHECK(importe>=0), UNIQUE(id_factura_proveedor,id_orden_detalle)
);
CREATE TABLE IF NOT EXISTS factura_proveedor_recepcion (
  id_factura_detalle bigint NOT NULL REFERENCES factura_proveedor_detalle(id_detalle) ON DELETE CASCADE,
  id_recepcion_detalle integer NOT NULL REFERENCES recepcion_compra_detalle(id_detalle),
  cantidad numeric(18,6) NOT NULL CHECK(cantidad>0), PRIMARY KEY(id_factura_detalle,id_recepcion_detalle)
);
CREATE INDEX IF NOT EXISTS idx_factura_proveedor_recepcion_detalle ON factura_proveedor_recepcion(id_recepcion_detalle);

CREATE TABLE IF NOT EXISTS factura_proveedor_discrepancia (
  id_discrepancia bigserial PRIMARY KEY,
  id_factura_proveedor bigint NOT NULL REFERENCES factura_proveedor(id_factura_proveedor) ON DELETE CASCADE,
  id_factura_detalle bigint REFERENCES factura_proveedor_detalle(id_detalle) ON DELETE CASCADE,
  tipo varchar(25) NOT NULL CHECK(tipo IN ('Cantidad','Precio','Impuesto','Sin recepcion')),
  esperado numeric(18,6), recibido numeric(18,6), diferencia numeric(18,6),
  estado varchar(15) NOT NULL DEFAULT 'Pendiente' CHECK(estado IN ('Pendiente','Aprobada','Rechazada')),
  justificacion varchar(1000), resuelta_por integer REFERENCES auth_user(id_user) ON DELETE SET NULL,
  resuelta_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_factura_proveedor_discrepancia ON factura_proveedor_discrepancia(id_factura_proveedor,estado);

CREATE TABLE IF NOT EXISTS nota_credito_proveedor (
  id_nota bigserial PRIMARY KEY, request_id uuid NOT NULL UNIQUE,
  id_proveedor integer NOT NULL REFERENCES proveedor("IdProveedor"), uuid uuid, folio varchar(80) NOT NULL,
  fecha date NOT NULL, total numeric(18,2) NOT NULL CHECK(total>0),
  saldo_disponible numeric(18,2) NOT NULL CHECK(saldo_disponible>=0),
  estado varchar(15) NOT NULL DEFAULT 'Disponible' CHECK(estado IN ('Disponible','Aplicada','Cancelada')),
  notas varchar(1000), id_user integer REFERENCES auth_user(id_user) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_nota_credito_proveedor_uuid ON nota_credito_proveedor(uuid) WHERE uuid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_nota_credito_proveedor_folio ON nota_credito_proveedor(id_proveedor,lower(folio)) WHERE estado<>'Cancelada';

CREATE TABLE IF NOT EXISTS anticipo_proveedor (
  id_anticipo bigserial PRIMARY KEY, request_id uuid NOT NULL UNIQUE,
  id_proveedor integer NOT NULL REFERENCES proveedor("IdProveedor"), fecha date NOT NULL,
  monto numeric(18,2) NOT NULL CHECK(monto>0), saldo_disponible numeric(18,2) NOT NULL CHECK(saldo_disponible>=0),
  forma_pago varchar(40) NOT NULL, referencia varchar(120), estado varchar(15) NOT NULL DEFAULT 'Disponible'
    CHECK(estado IN ('Disponible','Aplicado','Cancelado')), notas varchar(1000),
  id_user integer REFERENCES auth_user(id_user) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS aplicacion_proveedor (
  id_aplicacion bigserial PRIMARY KEY, id_factura_proveedor bigint NOT NULL REFERENCES factura_proveedor(id_factura_proveedor),
  tipo varchar(12) NOT NULL CHECK(tipo IN ('NotaCredito','Anticipo')),
  id_nota bigint REFERENCES nota_credito_proveedor(id_nota), id_anticipo bigint REFERENCES anticipo_proveedor(id_anticipo),
  monto numeric(18,2) NOT NULL CHECK(monto>0), id_user integer REFERENCES auth_user(id_user) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((tipo='NotaCredito' AND id_nota IS NOT NULL AND id_anticipo IS NULL) OR
        (tipo='Anticipo' AND id_anticipo IS NOT NULL AND id_nota IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_aplicacion_nota_proveedor ON aplicacion_proveedor(id_factura_proveedor,id_nota) WHERE id_nota IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_aplicacion_anticipo_proveedor ON aplicacion_proveedor(id_factura_proveedor,id_anticipo) WHERE id_anticipo IS NOT NULL;

CREATE TABLE IF NOT EXISTS factura_proveedor_programacion (
  id_programacion bigserial PRIMARY KEY, id_factura_proveedor bigint NOT NULL REFERENCES factura_proveedor(id_factura_proveedor) ON DELETE CASCADE,
  fecha_programada date NOT NULL, monto numeric(18,2) NOT NULL CHECK(monto>0),
  estado varchar(15) NOT NULL DEFAULT 'Pendiente' CHECK(estado IN ('Pendiente','Pagada','Cancelada')),
  notas varchar(500), id_user integer REFERENCES auth_user(id_user) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_factura_proveedor_programacion ON factura_proveedor_programacion(fecha_programada,estado);

CREATE TABLE IF NOT EXISTS factura_proveedor_pago (
  id_pago bigserial PRIMARY KEY, request_id uuid NOT NULL UNIQUE,
  id_factura_proveedor bigint NOT NULL REFERENCES factura_proveedor(id_factura_proveedor),
  id_programacion bigint REFERENCES factura_proveedor_programacion(id_programacion),
  fecha date NOT NULL DEFAULT CURRENT_DATE, monto numeric(18,2) NOT NULL CHECK(monto>0),
  forma_pago varchar(40) NOT NULL, referencia varchar(120), notas varchar(1000),
  id_user integer REFERENCES auth_user(id_user) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO app_permission(code,description) VALUES
 ('compras.facturas','Capturar y conciliar facturas de proveedor'),
 ('compras.pagar','Aprobar facturas y registrar pagos a proveedores')
ON CONFLICT(code) DO UPDATE SET description=excluded.description;
INSERT INTO app_role_permission(role,permission_code) VALUES
 ('admin','compras.facturas'),('admin','compras.pagar') ON CONFLICT DO NOTHING;

INSERT INTO cuenta_contable(codigo,nombre,tipo,naturaleza,acepta_movimientos)
VALUES('1150','Anticipos a proveedores','Activo','D',true)
ON CONFLICT(codigo) DO UPDATE SET nombre=excluded.nombre,activa=true,updated_at=clock_timestamp();
UPDATE cuenta_contable SET id_padre=(SELECT id_cuenta FROM cuenta_contable WHERE codigo='1000') WHERE codigo='1150';

CREATE OR REPLACE FUNCTION fn_poliza_factura_proveedor(p_id bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE f record; v_id bigint; v_activa boolean;
BEGIN
 SELECT * INTO f FROM factura_proveedor WHERE id_factura_proveedor=p_id; IF NOT FOUND THEN RETURN; END IF;
 v_activa:=f.estado IN ('Aprobada','Parcialmente pagada','Pagada');
 v_id:=fn_preparar_poliza_automatica('FacturaProveedor',p_id,f.fecha_emision,'Diario','Factura proveedor '||coalesce(f.serie||'-','')||f.folio,v_activa);
 IF NOT v_activa THEN RETURN; END IF;
 INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES(v_id,fn_cuenta_contable_id('1130'),'Mercancia facturada',round(f.total*f.tipo_cambio,2));
 INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES(v_id,fn_cuenta_contable_id('2100'),'Cuenta por pagar',round(f.total*f.tipo_cambio,2));
END $$;
CREATE OR REPLACE FUNCTION fn_sync_poliza_factura_proveedor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM fn_poliza_factura_proveedor(coalesce(NEW.id_factura_proveedor,OLD.id_factura_proveedor)); RETURN coalesce(NEW,OLD); END $$;
CREATE TRIGGER trg_poliza_factura_proveedor AFTER INSERT OR UPDATE OF estado,total ON factura_proveedor
FOR EACH ROW EXECUTE FUNCTION fn_sync_poliza_factura_proveedor();

CREATE OR REPLACE FUNCTION fn_poliza_factura_proveedor_pago() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id bigint; v_tipo_cambio numeric(18,6);
BEGIN
 SELECT tipo_cambio INTO v_tipo_cambio FROM factura_proveedor WHERE id_factura_proveedor=NEW.id_factura_proveedor;
 v_id:=fn_preparar_poliza_automatica('PagoFacturaProveedor',NEW.id_pago,NEW.fecha,'Egreso','Pago factura proveedor '||NEW.id_factura_proveedor,true);
 INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES(v_id,fn_cuenta_contable_id('2100'),'Aplicacion a proveedor',round(NEW.monto*v_tipo_cambio,2));
 INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES(v_id,fn_cuenta_contable_id(CASE WHEN NEW.forma_pago ILIKE '%Efectivo%' THEN '1100' ELSE '1110' END),'Salida de fondos',round(NEW.monto*v_tipo_cambio,2));
 RETURN NEW;
END $$;
CREATE TRIGGER trg_poliza_factura_proveedor_pago AFTER INSERT ON factura_proveedor_pago
FOR EACH ROW EXECUTE FUNCTION fn_poliza_factura_proveedor_pago();

CREATE OR REPLACE FUNCTION fn_poliza_anticipo_proveedor() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
 v_id:=fn_preparar_poliza_automatica('AnticipoProveedor',NEW.id_anticipo,NEW.fecha,'Egreso','Anticipo a proveedor '||NEW.id_proveedor,NEW.estado<>'Cancelado');
 IF NEW.estado='Cancelado' THEN RETURN NEW; END IF;
 INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES(v_id,fn_cuenta_contable_id('1150'),'Anticipo a proveedor',NEW.monto);
 INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES(v_id,fn_cuenta_contable_id(CASE WHEN NEW.forma_pago ILIKE '%Efectivo%' THEN '1100' ELSE '1110' END),'Salida de fondos',NEW.monto);
 RETURN NEW;
END $$;
CREATE TRIGGER trg_poliza_anticipo_proveedor AFTER INSERT OR UPDATE OF estado ON anticipo_proveedor
FOR EACH ROW EXECUTE FUNCTION fn_poliza_anticipo_proveedor();

CREATE OR REPLACE FUNCTION fn_poliza_aplicacion_proveedor() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
 v_id:=fn_preparar_poliza_automatica('AplicacionProveedor',NEW.id_aplicacion,NEW.created_at::date,'Diario','Aplicacion de '||NEW.tipo||' a factura '||NEW.id_factura_proveedor,true);
 INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES(v_id,fn_cuenta_contable_id('2100'),'Disminucion de cuenta por pagar',NEW.monto);
 INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES
  (v_id,fn_cuenta_contable_id(CASE WHEN NEW.tipo='Anticipo' THEN '1150' ELSE '1130' END),'Aplicacion de saldo a favor',NEW.monto);
 RETURN NEW;
END $$;
CREATE TRIGGER trg_poliza_aplicacion_proveedor AFTER INSERT ON aplicacion_proveedor
FOR EACH ROW EXECUTE FUNCTION fn_poliza_aplicacion_proveedor();

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['factura_proveedor','factura_proveedor_detalle','factura_proveedor_recepcion','factura_proveedor_discrepancia','nota_credito_proveedor','anticipo_proveedor','aplicacion_proveedor','factura_proveedor_programacion','factura_proveedor_pago'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_jsonb_%I ON %I',t,t);
  EXECUTE format('CREATE TRIGGER trg_audit_jsonb_%I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger()',t,t);
 END LOOP;
END $$;
