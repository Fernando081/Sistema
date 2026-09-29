-- Cancelación segura de cuentas por pagar y reverso explícito de pagos.
ALTER TABLE factura_proveedor
  ADD COLUMN cancelada_por integer REFERENCES auth_user(id_user) ON DELETE SET NULL,
  ADD COLUMN cancelada_at timestamptz,
  ADD COLUMN motivo_cancelacion varchar(1000);

ALTER TABLE factura_proveedor_pago
  ADD COLUMN estado varchar(12) NOT NULL DEFAULT 'Activo' CHECK(estado IN('Activo','Revertido')),
  ADD COLUMN revertido_por integer REFERENCES auth_user(id_user) ON DELETE SET NULL,
  ADD COLUMN revertido_at timestamptz,
  ADD COLUMN motivo_reversion varchar(1000);

ALTER TABLE aplicacion_proveedor
  ADD COLUMN estado varchar(12) NOT NULL DEFAULT 'Activa' CHECK(estado IN('Activa','Revertida')),
  ADD COLUMN revertida_por integer REFERENCES auth_user(id_user) ON DELETE SET NULL,
  ADD COLUMN revertida_at timestamptz,
  ADD COLUMN motivo_reversion varchar(1000);

INSERT INTO app_permission(code,description) VALUES
 ('compras.cancelar','Revertir pagos y cancelar facturas de proveedor')
ON CONFLICT(code) DO UPDATE SET description=excluded.description;
INSERT INTO app_role_permission(role,permission_code) VALUES
 ('admin','compras.cancelar') ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION fn_poliza_factura_proveedor_pago() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id bigint; v_tipo_cambio numeric(18,6); v_activa boolean;
BEGIN
 SELECT tipo_cambio INTO v_tipo_cambio FROM factura_proveedor WHERE id_factura_proveedor=NEW.id_factura_proveedor;
 v_activa:=NEW.estado='Activo';
 v_id:=fn_preparar_poliza_automatica('PagoFacturaProveedor',NEW.id_pago,NEW.fecha,'Egreso','Pago factura proveedor '||NEW.id_factura_proveedor,v_activa);
 IF NOT v_activa THEN RETURN NEW; END IF;
 INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES(v_id,fn_cuenta_contable_id('2100'),'Aplicacion a proveedor',round(NEW.monto*v_tipo_cambio,2));
 INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES(v_id,fn_cuenta_contable_id(CASE WHEN NEW.forma_pago ILIKE '%Efectivo%' THEN '1100' ELSE '1110' END),'Salida de fondos',round(NEW.monto*v_tipo_cambio,2));
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_poliza_factura_proveedor_pago ON factura_proveedor_pago;
CREATE TRIGGER trg_poliza_factura_proveedor_pago AFTER INSERT OR UPDATE OF estado ON factura_proveedor_pago
FOR EACH ROW EXECUTE FUNCTION fn_poliza_factura_proveedor_pago();

CREATE OR REPLACE FUNCTION fn_poliza_aplicacion_proveedor() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id bigint; v_activa boolean;
BEGIN
 v_activa:=NEW.estado='Activa';
 v_id:=fn_preparar_poliza_automatica('AplicacionProveedor',NEW.id_aplicacion,NEW.created_at::date,'Diario','Aplicacion de '||NEW.tipo||' a factura '||NEW.id_factura_proveedor,v_activa);
 IF NOT v_activa THEN RETURN NEW; END IF;
 INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES(v_id,fn_cuenta_contable_id('2100'),'Disminucion de cuenta por pagar',NEW.monto);
 INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES
  (v_id,fn_cuenta_contable_id(CASE WHEN NEW.tipo='Anticipo' THEN '1150' ELSE '1130' END),'Aplicacion de saldo a favor',NEW.monto);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_poliza_aplicacion_proveedor ON aplicacion_proveedor;
CREATE TRIGGER trg_poliza_aplicacion_proveedor AFTER INSERT OR UPDATE OF estado ON aplicacion_proveedor
FOR EACH ROW EXECUTE FUNCTION fn_poliza_aplicacion_proveedor();
