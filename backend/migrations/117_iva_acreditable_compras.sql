-- U-IVA (28/10/2026) · IVA de compras separado del inventario y días de crédito por proveedor.
-- Decisión del propietario: IVA acreditable pendiente de pago (1160) al aprobar la factura y
-- traspaso a IVA acreditable pagado (1170) en la proporción de cada pago o anticipo aplicado.
-- No reescribe pólizas existentes: sólo cambia cómo se generan las nuevas (o las que se recalculen).

INSERT INTO cuenta_contable(codigo,nombre,tipo,naturaleza,acepta_movimientos) VALUES
 ('1160','IVA acreditable pendiente de pago','Activo','D',true),
 ('1170','IVA acreditable pagado','Activo','D',true)
ON CONFLICT(codigo) DO UPDATE SET nombre=excluded.nombre,activa=true,updated_at=clock_timestamp();
UPDATE cuenta_contable SET id_padre=(SELECT id_cuenta FROM cuenta_contable WHERE codigo='1000') WHERE codigo IN ('1160','1170');

ALTER TABLE proveedor ADD COLUMN "DiasCredito" integer NOT NULL DEFAULT 30
  CONSTRAINT ck_proveedor_dias_credito CHECK("DiasCredito" BETWEEN 0 AND 365);

-- Parte de IVA de un monto aplicado a una factura de proveedor, proporcional a impuestos/total.
CREATE OR REPLACE FUNCTION fn_iva_proporcional_factura_proveedor(p_id bigint,p_monto numeric) RETURNS numeric
LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN f.impuestos>0 AND f.total>0 THEN round(p_monto*f.impuestos/f.total,2) ELSE 0 END
   FROM factura_proveedor f WHERE f.id_factura_proveedor=p_id $$;

CREATE OR REPLACE FUNCTION fn_poliza_factura_proveedor(p_id bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE f record; v_id bigint; v_activa boolean; v_total numeric(18,2); v_iva numeric(18,2);
BEGIN
 SELECT * INTO f FROM factura_proveedor WHERE id_factura_proveedor=p_id; IF NOT FOUND THEN RETURN; END IF;
 v_activa:=f.estado IN ('Aprobada','Parcialmente pagada','Pagada');
 v_id:=fn_preparar_poliza_automatica('FacturaProveedor',p_id,f.fecha_emision,'Diario','Factura proveedor '||coalesce(f.serie||'-','')||f.folio,v_activa);
 IF NOT v_activa THEN RETURN; END IF;
 v_total:=round(f.total*f.tipo_cambio,2);
 v_iva:=least(v_total,round(f.impuestos*f.tipo_cambio,2));
 INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES(v_id,fn_cuenta_contable_id('1130'),'Mercancia facturada',v_total-v_iva);
 IF v_iva>0 THEN
  INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES(v_id,fn_cuenta_contable_id('1160'),'IVA acreditable pendiente de pago',v_iva);
 END IF;
 INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES(v_id,fn_cuenta_contable_id('2100'),'Cuenta por pagar',v_total);
END $$;

CREATE OR REPLACE FUNCTION fn_poliza_factura_proveedor_pago() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id bigint; v_tipo_cambio numeric(18,6); v_activa boolean; v_monto numeric(18,2); v_iva numeric(18,2);
BEGIN
 SELECT tipo_cambio INTO v_tipo_cambio FROM factura_proveedor WHERE id_factura_proveedor=NEW.id_factura_proveedor;
 v_activa:=NEW.estado='Activo';
 v_id:=fn_preparar_poliza_automatica('PagoFacturaProveedor',NEW.id_pago,NEW.fecha,'Egreso','Pago factura proveedor '||NEW.id_factura_proveedor,v_activa);
 IF NOT v_activa THEN RETURN NEW; END IF;
 v_monto:=round(NEW.monto*v_tipo_cambio,2);
 INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES(v_id,fn_cuenta_contable_id('2100'),'Aplicacion a proveedor',v_monto);
 INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES(v_id,fn_cuenta_contable_id(CASE WHEN NEW.forma_pago ILIKE '%Efectivo%' THEN '1100' ELSE '1110' END),'Salida de fondos',v_monto);
 v_iva:=fn_iva_proporcional_factura_proveedor(NEW.id_factura_proveedor,v_monto);
 IF v_iva>0 THEN
  INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES(v_id,fn_cuenta_contable_id('1170'),'IVA acreditable pagado',v_iva);
  INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES(v_id,fn_cuenta_contable_id('1160'),'IVA pendiente que se paga',v_iva);
 END IF;
 RETURN NEW;
END $$;

-- Anticipo aplicado = pago: traspasa su IVA a pagado. Nota de crédito: disminuye inventario e IVA pendiente.
CREATE OR REPLACE FUNCTION fn_poliza_aplicacion_proveedor() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id bigint; v_activa boolean; v_iva numeric(18,2);
BEGIN
 v_activa:=NEW.estado='Activa';
 v_id:=fn_preparar_poliza_automatica('AplicacionProveedor',NEW.id_aplicacion,NEW.created_at::date,'Diario','Aplicacion de '||NEW.tipo||' a factura '||NEW.id_factura_proveedor,v_activa);
 IF NOT v_activa THEN RETURN NEW; END IF;
 v_iva:=fn_iva_proporcional_factura_proveedor(NEW.id_factura_proveedor,NEW.monto);
 INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES(v_id,fn_cuenta_contable_id('2100'),'Disminucion de cuenta por pagar',NEW.monto);
 IF NEW.tipo='Anticipo' THEN
  INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES(v_id,fn_cuenta_contable_id('1150'),'Aplicacion de saldo a favor',NEW.monto);
  IF v_iva>0 THEN
   INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES(v_id,fn_cuenta_contable_id('1170'),'IVA acreditable pagado',v_iva);
   INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES(v_id,fn_cuenta_contable_id('1160'),'IVA pendiente que se paga',v_iva);
  END IF;
 ELSE
  INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES(v_id,fn_cuenta_contable_id('1130'),'Aplicacion de saldo a favor',NEW.monto-v_iva);
  IF v_iva>0 THEN
   INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES(v_id,fn_cuenta_contable_id('1160'),'IVA de nota de credito',v_iva);
  END IF;
 END IF;
 RETURN NEW;
END $$;
