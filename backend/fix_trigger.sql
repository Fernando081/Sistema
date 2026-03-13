CREATE OR REPLACE FUNCTION fn_sync_ingreso_saldos()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.forma_pago ILIKE '%Efectivo%' THEN
        UPDATE saldos SET caja_chica = caja_chica + NEW.monto, updated_at = NOW();
    ELSE
        UPDATE saldos SET cuenta_banco = cuenta_banco + NEW.monto, updated_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_ingreso_saldos ON pago;
CREATE TRIGGER trg_sync_ingreso_saldos
AFTER INSERT ON pago
FOR EACH ROW
EXECUTE FUNCTION fn_sync_ingreso_saldos();
