-- 027_integridad_operativa.sql
-- Endurece permisos por defecto, folios, inventario y reversos financieros.
-- Diseñada para poder ejecutarse más de una vez sin borrar datos.

ALTER TABLE auth_user ALTER COLUMN role SET DEFAULT 'user';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM factura
     WHERE serie IS NOT NULL AND folio IS NOT NULL
     GROUP BY serie, folio HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'No se puede crear uq_factura_serie_folio: existen folios duplicados. Concílialos antes de continuar.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_factura_serie_folio
  ON factura (serie, folio)
  WHERE serie IS NOT NULL AND folio IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_factura_cliente_saldo
  ON factura (id_cliente, fecha_emision)
  WHERE saldo_pendiente > 0;

CREATE INDEX IF NOT EXISTS idx_compra_proveedor_saldo
  ON compra (id_proveedor, fecha_compra)
  WHERE saldo_pendiente > 0;

CREATE INDEX IF NOT EXISTS idx_kardex_producto_fecha
  ON kardex (id_producto, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_producto_busqueda_codigo
  ON producto (lower(regexp_replace(COALESCE("Codigo", ''), '[^[:alnum:]]', '', 'g')));

CREATE INDEX IF NOT EXISTS idx_producto_busqueda_descripcion
  ON producto (lower("Descripcion"));

CREATE OR REPLACE FUNCTION public.fn_kardex_venta()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_stock_actual numeric;
  v_folio_factura varchar;
  v_tipo_comprobante char(1);
  v_multiplicador int;
  v_tipo_movimiento varchar;
  v_referencia varchar;
  v_stock_resultante numeric;
BEGIN
  IF NEW.id_producto IS NULL THEN RETURN NEW; END IF;
  IF NEW.cantidad IS NULL OR NEW.cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad del concepto debe ser mayor a cero';
  END IF;

  SELECT "Existencia" INTO v_stock_actual
    FROM producto WHERE "IdProducto" = NEW.id_producto FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto % no encontrado', NEW.id_producto; END IF;

  SELECT CONCAT(serie, '-', folio), tipo_comprobante
    INTO v_folio_factura, v_tipo_comprobante
    FROM factura WHERE id_factura = NEW.id_factura;

  IF v_tipo_comprobante = 'E' THEN
    v_multiplicador := 1;
    v_tipo_movimiento := 'ENTRADA POR DEVOLUCION';
    v_referencia := CONCAT('Devolución/Egreso: ', v_folio_factura);
  ELSE
    v_multiplicador := -1;
    v_tipo_movimiento := 'VENTA';
    v_referencia := CONCAT('Venta Factura: ', v_folio_factura);
  END IF;

  v_stock_resultante := v_stock_actual + (NEW.cantidad * v_multiplicador);
  IF v_stock_resultante < 0 THEN
    RAISE EXCEPTION 'Stock insuficiente para producto %. Disponible: %, solicitado: %',
      NEW.id_producto, v_stock_actual, NEW.cantidad;
  END IF;

  UPDATE producto SET "Existencia" = v_stock_resultante
   WHERE "IdProducto" = NEW.id_producto;

  INSERT INTO kardex (
    id_producto, tipo_movimiento, cantidad, stock_anterior,
    stock_resultante, precio_unitario, referencia, id_referencia
  ) VALUES (
    NEW.id_producto, v_tipo_movimiento::tipo_movimiento_enum,
    NEW.cantidad * v_multiplicador, v_stock_actual,
    v_stock_resultante, NEW.valor_unitario, v_referencia, NEW.id_factura
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE PROCEDURE sp_ajustar_inventario(
  p_id_producto INT, p_cantidad NUMERIC, p_tipo VARCHAR, p_motivo VARCHAR
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_existencia_actual NUMERIC;
  v_stock_resultante NUMERIC;
  v_kardex_cantidad NUMERIC;
  v_precio_unitario NUMERIC;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad a ajustar debe ser mayor a cero.';
  END IF;
  IF p_tipo NOT IN ('ENTRADA POR AJUSTE', 'SALIDA POR MERMA/AJUSTE') THEN
    RAISE EXCEPTION 'Tipo de movimiento no válido.';
  END IF;
  IF p_motivo IS NULL OR TRIM(p_motivo) = '' THEN
    RAISE EXCEPTION 'El motivo del ajuste es obligatorio.';
  END IF;

  SELECT "Existencia", "PrecioUnitario"
    INTO v_existencia_actual, v_precio_unitario
    FROM producto WHERE "IdProducto" = p_id_producto FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado.'; END IF;

  IF p_tipo = 'ENTRADA POR AJUSTE' THEN
    v_kardex_cantidad := p_cantidad;
  ELSE
    v_kardex_cantidad := -p_cantidad;
  END IF;
  v_stock_resultante := v_existencia_actual + v_kardex_cantidad;
  IF v_stock_resultante < 0 THEN
    RAISE EXCEPTION 'El ajuste dejaría stock negativo (%).', v_stock_resultante;
  END IF;

  UPDATE producto SET "Existencia" = v_stock_resultante
   WHERE "IdProducto" = p_id_producto;
  INSERT INTO kardex (
    id_producto, tipo_movimiento, cantidad, stock_anterior,
    stock_resultante, precio_unitario, referencia
  ) VALUES (
    p_id_producto, p_tipo::tipo_movimiento_enum, v_kardex_cantidad,
    v_existencia_actual, v_stock_resultante, v_precio_unitario, TRIM(p_motivo)
  );
END;
$$;

CREATE OR REPLACE FUNCTION fn_sync_reverso_saldos()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.forma_pago ILIKE '%Efectivo%' THEN
    UPDATE saldos SET caja_chica = caja_chica - OLD.monto, updated_at = NOW();
  ELSE
    UPDATE saldos SET cuenta_banco = cuenta_banco - OLD.monto, updated_at = NOW();
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_reverso_saldos ON pago;
CREATE TRIGGER trg_sync_reverso_saldos
AFTER DELETE ON pago
FOR EACH ROW EXECUTE FUNCTION fn_sync_reverso_saldos();

COMMENT ON FUNCTION fn_sync_reverso_saldos() IS
  'Revierte caja/banco cuando se elimina un pago dentro de una cancelación transaccional.';
