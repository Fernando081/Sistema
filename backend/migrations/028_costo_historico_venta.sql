-- 028_costo_historico_venta.sql
-- Congela el costo conocido al momento de cada venta para que compras futuras
-- no reescriban la rentabilidad histórica. Si no existe costo, se conserva NULL.

ALTER TABLE conceptofactura
  ADD COLUMN IF NOT EXISTS costo_unitario_snapshot NUMERIC(18,6) NULL;

CREATE OR REPLACE FUNCTION fn_asignar_costo_venta()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_fecha_venta timestamptz;
BEGIN
  IF NEW.id_producto IS NULL OR NEW.costo_unitario_snapshot IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT fecha_emision INTO v_fecha_venta
    FROM factura WHERE id_factura = NEW.id_factura;

  SELECT SUM(dc.importe) / NULLIF(SUM(dc.cantidad), 0)
    INTO NEW.costo_unitario_snapshot
    FROM detalle_compra dc
    JOIN compra c ON c.id_compra = dc.id_compra
   WHERE dc.id_producto = NEW.id_producto
     AND c.fecha_compra <= v_fecha_venta
     AND c.estatus::text NOT IN ('Cancelada', 'Cancelado');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_asignar_costo_venta ON conceptofactura;
CREATE TRIGGER trg_asignar_costo_venta
BEFORE INSERT ON conceptofactura
FOR EACH ROW EXECUTE FUNCTION fn_asignar_costo_venta();

UPDATE conceptofactura cf
   SET costo_unitario_snapshot = (
    SELECT SUM(dc.importe) / NULLIF(SUM(dc.cantidad), 0) AS costo_unitario
      FROM detalle_compra dc
      JOIN compra c ON c.id_compra = dc.id_compra
      JOIN factura f ON f.id_factura = cf.id_factura
     WHERE dc.id_producto = cf.id_producto
       AND c.fecha_compra <= f.fecha_emision
       AND c.estatus::text NOT IN ('Cancelada', 'Cancelado')
  )
 WHERE cf.costo_unitario_snapshot IS NULL
   AND cf.id_producto IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM detalle_compra dc
     JOIN compra c ON c.id_compra = dc.id_compra
     JOIN factura f ON f.id_factura = cf.id_factura
     WHERE dc.id_producto = cf.id_producto
       AND c.fecha_compra <= f.fecha_emision
       AND c.estatus::text NOT IN ('Cancelada', 'Cancelado')
   );

CREATE OR REPLACE FUNCTION fn_get_margen_productos()
RETURNS TABLE (
  id_producto INT,
  codigo VARCHAR,
  descripcion VARCHAR,
  cantidad_vendida NUMERIC,
  ingresos_totales NUMERIC,
  costo_total NUMERIC,
  utilidad_bruta NUMERIC,
  margen_porcentaje NUMERIC,
  costo_conocido BOOLEAN
)
LANGUAGE sql STABLE AS $$
  SELECT
    p."IdProducto",
    p."Codigo",
    p."Descripcion",
    SUM(cf.cantidad),
    SUM(cf.importe - COALESCE(cf.descuento, 0)),
    CASE WHEN bool_and(cf.costo_unitario_snapshot IS NOT NULL)
      THEN SUM(cf.cantidad * cf.costo_unitario_snapshot) END,
    CASE WHEN bool_and(cf.costo_unitario_snapshot IS NOT NULL)
      THEN SUM(cf.importe - COALESCE(cf.descuento, 0))
         - SUM(cf.cantidad * cf.costo_unitario_snapshot) END,
    CASE
      WHEN bool_and(cf.costo_unitario_snapshot IS NOT NULL)
       AND SUM(cf.importe - COALESCE(cf.descuento, 0)) <> 0
      THEN (
        SUM(cf.importe - COALESCE(cf.descuento, 0))
        - SUM(cf.cantidad * cf.costo_unitario_snapshot)
      ) / SUM(cf.importe - COALESCE(cf.descuento, 0)) * 100
    END,
    bool_and(cf.costo_unitario_snapshot IS NOT NULL)
  FROM producto p
  JOIN conceptofactura cf ON cf.id_producto = p."IdProducto"
  JOIN factura f ON f.id_factura = cf.id_factura
  WHERE f.estatus::text <> 'Cancelada'
    AND COALESCE(f.tipo_comprobante, 'I') = 'I'
  GROUP BY p."IdProducto", p."Codigo", p."Descripcion"
  ORDER BY 7 DESC NULLS LAST;
$$;

COMMENT ON COLUMN conceptofactura.costo_unitario_snapshot IS
  'Costo promedio conocido congelado al crear la venta; NULL significa costo desconocido.';
