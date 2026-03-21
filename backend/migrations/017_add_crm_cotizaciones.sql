-- backend/migrations/017_add_crm_cotizaciones.sql

-- 1. Agregar campos de rastreo para CRM a conceptocotizacion
ALTER TABLE conceptocotizacion
ADD COLUMN estatus VARCHAR(20) DEFAULT 'Pendiente',
ADD COLUMN motivo_rechazo VARCHAR(100) NULL,
ADD COLUMN precio_cierre NUMERIC(10,2) NULL;

-- Constraint para validación fuerte de Estatus
ALTER TABLE conceptocotizacion
ADD CONSTRAINT chk_conceptocotizacion_estatus CHECK (estatus IN ('Pendiente', 'Comprada', 'Rechazada'));

-- 2. Vincular la tabla de Ventas con la Cotización que le dio origen
ALTER TABLE factura
ADD COLUMN id_cotizacion INT NULL;

ALTER TABLE factura
ADD CONSTRAINT fk_factura_cotizacion FOREIGN KEY (id_cotizacion) REFERENCES cotizacion(id_cotizacion) ON DELETE SET NULL;
