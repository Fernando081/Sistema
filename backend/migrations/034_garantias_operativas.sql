-- 034_garantias_operativas.sql
-- Hace operable el seguimiento de garantías y expone el renglón original de venta.

ALTER TABLE garantia ADD COLUMN IF NOT EXISTS cantidad numeric(14,4) NOT NULL DEFAULT 1;
ALTER TABLE garantia ADD COLUMN IF NOT EXISTS destino_producto varchar(20) NOT NULL DEFAULT 'Revision';
ALTER TABLE garantia ADD COLUMN IF NOT EXISTS evidencias jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE garantia ADD COLUMN IF NOT EXISTS id_user integer NULL REFERENCES auth_user(id_user) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_garantia_cantidad_positiva') THEN
    ALTER TABLE garantia ADD CONSTRAINT ck_garantia_cantidad_positiva CHECK (cantidad > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_garantia_destino_producto') THEN
    ALTER TABLE garantia ADD CONSTRAINT ck_garantia_destino_producto
      CHECK (destino_producto IN ('Vendible', 'Revision', 'Proveedor', 'Merma'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_garantia_evidencias_array') THEN
    ALTER TABLE garantia ADD CONSTRAINT ck_garantia_evidencias_array
      CHECK (jsonb_typeof(evidencias) = 'array');
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_audit_jsonb_garantia ON garantia;
CREATE TRIGGER trg_audit_jsonb_garantia
AFTER INSERT OR UPDATE OR DELETE ON garantia
FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

DROP FUNCTION IF EXISTS public.fn_get_detalle_factura(integer);
CREATE FUNCTION public.fn_get_detalle_factura(p_id_factura integer)
RETURNS TABLE(
  id_concepto integer,
  id_producto integer,
  codigo_producto varchar,
  descripcion_producto text,
  unidad varchar,
  cantidad numeric,
  cantidad_devuelta numeric,
  precio_unitario numeric,
  importe numeric,
  pct_iva numeric,
  importe_iva numeric,
  pct_ret_isr numeric,
  importe_ret_isr numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    d.id_concepto,
    p."IdProducto",
    p."Codigo",
    d.descripcion::text,
    d.unidad_sat,
    d.cantidad,
    COALESCE((
      SELECT SUM(dd.cantidad)
        FROM devolucion_detalle dd
        JOIN devolucion dev ON dev.id_devolucion = dd.id_devolucion
       WHERE dev.id_factura = p_id_factura
         AND dd.id_producto = p."IdProducto"
    ), 0)::numeric,
    d.valor_unitario,
    d.importe,
    d.tasa_iva,
    d.importe_iva,
    d.tasa_ret_isr,
    d.importe_ret_isr
  FROM conceptofactura d
  JOIN producto p ON p."IdProducto" = d.id_producto
  WHERE d.id_factura = p_id_factura
  ORDER BY d.id_concepto;
$$;

COMMENT ON TABLE garantia IS
  'Seguimiento de reclamaciones vinculadas al renglón original de una venta.';
