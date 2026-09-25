-- Vínculos explícitos para reembolsos y REP; no se infieren notas antiguas por UUID ficticio.
ALTER TABLE factura ADD COLUMN IF NOT EXISTS id_factura_origen integer REFERENCES factura(id_factura);
ALTER TABLE factura ADD COLUMN IF NOT EXISTS metodo_reembolso varchar(30);
ALTER TABLE factura ADD COLUMN IF NOT EXISTS id_gasto_reembolso integer REFERENCES gasto(id_gasto);
ALTER TABLE pago ADD COLUMN IF NOT EXISTS id_rep integer REFERENCES rep(id_rep);
CREATE INDEX IF NOT EXISTS idx_factura_origen ON factura(id_factura_origen);
CREATE INDEX IF NOT EXISTS idx_pago_rep ON pago(id_rep) WHERE id_rep IS NOT NULL;

-- Se registran salidas nuevas. No se altera el saldo histórico sin conciliación.
CREATE OR REPLACE FUNCTION fn_sync_pago_proveedor_saldos()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.forma_pago ILIKE '%Efectivo%' THEN
    UPDATE saldos SET caja_chica=caja_chica-NEW.monto,updated_at=now();
  ELSE
    UPDATE saldos SET cuenta_banco=cuenta_banco-NEW.monto,updated_at=now();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_sync_pago_proveedor_saldos ON pago_proveedor;
CREATE TRIGGER trg_sync_pago_proveedor_saldos AFTER INSERT ON pago_proveedor
FOR EACH ROW EXECUTE FUNCTION fn_sync_pago_proveedor_saldos();

-- El folio se asigna dentro del mismo bloqueo que el cálculo MAX + 1.
CREATE OR REPLACE FUNCTION fn_bloquear_folio_cotizacion()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('cotizacion-folio'));
  SELECT coalesce(max(folio),0)+1 INTO NEW.folio FROM cotizacion;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_bloquear_folio_cotizacion ON cotizacion;
CREATE TRIGGER trg_bloquear_folio_cotizacion BEFORE INSERT ON cotizacion
FOR EACH ROW EXECUTE FUNCTION fn_bloquear_folio_cotizacion();

CREATE OR REPLACE FUNCTION fn_comision_nota_credito()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_devuelto numeric;
BEGIN
  IF NEW.id_factura_origen IS NULL THEN RETURN NEW; END IF;
  SELECT coalesce(sum(subtotal),0) INTO v_devuelto FROM factura
    WHERE id_factura_origen=NEW.id_factura_origen AND estatus::text<>'Cancelada';
  UPDATE factura SET comision_vendedor=CASE WHEN id_vendedor IS NULL THEN 0
    ELSE greatest(0,round((subtotal-v_devuelto)*0.02,2)) END WHERE id_factura=NEW.id_factura_origen;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_comision_nota_credito ON factura;
CREATE TRIGGER trg_comision_nota_credito AFTER UPDATE OF id_factura_origen,estatus ON factura
FOR EACH ROW EXECUTE FUNCTION fn_comision_nota_credito();

-- Compatibilidad acotada: solo pagos cuyo contenido corresponde al alta anterior de REP.
UPDATE pago p SET id_rep = r.id_rep
  FROM rep r JOIN rep_factura rf ON rf.id_rep = r.id_rep
 WHERE p.id_rep IS NULL AND r.estado <> 'Cancelado'
   AND p.referencia = 'REP-' || r.id_rep::text
   AND p.notas = 'Generado via Módulo REP'
   AND p.id_factura = rf.id_factura AND p.monto = rf.monto_pagado
   AND p.fecha_pago = r.fecha_pago;

CREATE OR REPLACE FUNCTION fn_validar_cancelacion_financiera()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estatus::text <> 'Cancelada' OR OLD.estatus::text = 'Cancelada' THEN RETURN NEW; END IF;
  IF OLD.id_factura_global IS NOT NULL THEN
    RAISE EXCEPTION 'Cancela primero la factura global que agrupa este ticket';
  END IF;
  IF EXISTS (SELECT 1 FROM rep_factura rf JOIN rep r ON r.id_rep=rf.id_rep
              WHERE rf.id_factura=OLD.id_factura AND r.estado <> 'Cancelado') THEN
    RAISE EXCEPTION 'Cancela primero los REP vigentes de la factura';
  END IF;
  IF EXISTS (SELECT 1 FROM factura nc WHERE nc.id_factura_origen=OLD.id_factura
              AND nc.estatus::text <> 'Cancelada') THEN
    RAISE EXCEPTION 'Cancela primero las notas de crédito vigentes de la factura';
  END IF;
  IF EXISTS (SELECT 1 FROM garantia WHERE id_factura=OLD.id_factura AND estado NOT IN ('Rechazada','Cerrada')) THEN
    RAISE EXCEPTION 'Resuelve las garantías abiertas antes de cancelar la factura';
  END IF;
  IF OLD.tipo_comprobante = 'E' THEN
    IF OLD.id_factura_origen IS NULL OR OLD.metodo_reembolso IS NULL THEN
      RAISE EXCEPTION 'Nota de crédito histórica sin vínculo financiero: requiere conciliación antes de cancelarse';
    END IF;
    IF OLD.metodo_reembolso = 'Saldo a Favor' THEN
      UPDATE cliente SET saldo_a_favor = saldo_a_favor - OLD.total
        WHERE "IdCliente" = OLD.id_cliente AND saldo_a_favor >= OLD.total;
      IF NOT FOUND THEN RAISE EXCEPTION 'El saldo a favor ya se utilizó; concilia antes de cancelar'; END IF;
    ELSIF OLD.metodo_reembolso = 'Efectivo' THEN
      IF OLD.id_gasto_reembolso IS NULL THEN
        RAISE EXCEPTION 'No se encontró el gasto del reembolso';
      END IF;
      -- La factura mantiene el vínculo para auditoría; el gasto se marca anulado
      -- y los reportes lo excluyen. No se borra la evidencia del desembolso.
      UPDATE gasto SET anulado = true WHERE id_gasto = OLD.id_gasto_reembolso AND NOT anulado;
      IF NOT FOUND THEN RAISE EXCEPTION 'El gasto del reembolso ya fue revertido'; END IF;
      UPDATE saldos SET caja_chica = caja_chica + OLD.total, updated_at=now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE gasto ADD COLUMN IF NOT EXISTS anulado boolean NOT NULL DEFAULT false;
DROP TRIGGER IF EXISTS trg_validar_cancelacion_financiera ON factura;
CREATE TRIGGER trg_validar_cancelacion_financiera BEFORE UPDATE OF estatus ON factura
FOR EACH ROW EXECUTE FUNCTION fn_validar_cancelacion_financiera();

CREATE OR REPLACE FUNCTION fn_validar_devolucion_pagada()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_factura factura%ROWTYPE;
BEGIN
  SELECT * INTO v_factura FROM factura WHERE id_factura=NEW.id_factura FOR UPDATE;
  IF v_factura.saldo_pendiente <> 0 THEN
    RAISE EXCEPTION 'Liquida o concilia el saldo de la factura antes de reembolsar';
  END IF;
  IF v_factura.id_factura_global IS NOT NULL OR v_factura.serie='G' THEN
    RAISE EXCEPTION 'Cancela o concilia la factura global antes de devolver sus tickets';
  END IF;
  IF EXISTS (SELECT 1 FROM factura WHERE id_factura_origen=NEW.id_factura AND estatus::text <> 'Cancelada') THEN
    RAISE EXCEPTION 'La factura ya tiene notas de crédito: continúa con ese flujo';
  END IF;
  IF EXISTS (SELECT 1 FROM garantia WHERE id_factura=NEW.id_factura AND estado NOT IN ('Rechazada','Cerrada')) THEN
    RAISE EXCEPTION 'Resuelve las garantías abiertas antes de devolver la factura';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_validar_devolucion_pagada ON devolucion;
CREATE TRIGGER trg_validar_devolucion_pagada BEFORE INSERT ON devolucion
FOR EACH ROW EXECUTE FUNCTION fn_validar_devolucion_pagada();

-- La comisión se reduce proporcionalmente al total acumulado, no sobre una
-- comisión ya reducida (la fórmula anterior infradescontaba la segunda devolución).
CREATE OR REPLACE FUNCTION fn_recalcular_comision_devolucion()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_total numeric; v_subtotal numeric; v_vendedor integer; v_devuelto numeric;
BEGIN
  IF NEW.monto_total <= 0 THEN RETURN NEW; END IF;
  SELECT total, subtotal, id_vendedor INTO v_total, v_subtotal, v_vendedor
    FROM factura WHERE id_factura=NEW.id_factura FOR UPDATE;
  IF v_vendedor IS NOT NULL AND v_total > 0 THEN
    SELECT COALESCE(SUM(monto_total),0) INTO v_devuelto FROM devolucion WHERE id_factura=NEW.id_factura;
    IF v_devuelto > v_total THEN RAISE EXCEPTION 'El reembolso acumulado excede el total de la factura'; END IF;
    UPDATE factura SET comision_vendedor=greatest(0,round(v_subtotal*0.02*(1-v_devuelto/v_total),2))
      WHERE id_factura=NEW.id_factura;
  END IF;
  RETURN NEW;
END;
$$;
-- Se usa un constraint trigger diferido para ejecutar después del cálculo legado.
DROP TRIGGER IF EXISTS trg_recalcular_comision_devolucion ON devolucion;
CREATE CONSTRAINT TRIGGER trg_recalcular_comision_devolucion
AFTER UPDATE ON devolucion DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION fn_recalcular_comision_devolucion();

-- El flete aumenta el costo de las existencias, no el total facturado por el
-- proveedor. Mantener total y saldo separados evita alterar su deuda al pagar paquetería.
CREATE OR REPLACE FUNCTION fn_gasto_saldos_y_landed_cost()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_total_compra numeric;
BEGIN
  IF NEW.metodo_pago ILIKE '%Efectivo%' THEN
    UPDATE saldos SET caja_chica=caja_chica-NEW.monto, updated_at=now();
  ELSE
    UPDATE saldos SET cuenta_banco=cuenta_banco-NEW.monto, updated_at=now();
  END IF;
  IF NEW.categoria='Flete/Paquetería' AND NEW.id_compra IS NOT NULL THEN
    PERFORM 1 FROM compra WHERE id_compra=NEW.id_compra FOR UPDATE;
    SELECT SUM(importe) INTO v_total_compra FROM detalle_compra WHERE id_compra=NEW.id_compra;
    IF v_total_compra > 0 THEN
      UPDATE detalle_compra
         SET costo_unitario=costo_unitario+((NEW.monto*importe/v_total_compra)/cantidad),
             importe=importe+(NEW.monto*importe/v_total_compra)
       WHERE id_compra=NEW.id_compra AND cantidad>0;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Algunas bases históricas marcaron 006 como aplicada sin conservar este
-- trigger. Recrearlo garantiza que todo gasto nuevo afecte caja/banco.
DROP TRIGGER IF EXISTS trg_gasto_saldos_y_landed_cost ON gasto;
CREATE TRIGGER trg_gasto_saldos_y_landed_cost
AFTER INSERT ON gasto
FOR EACH ROW EXECUTE FUNCTION fn_gasto_saldos_y_landed_cost();
