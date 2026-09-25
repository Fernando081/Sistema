-- Permisos granulares sin romper los roles existentes.
CREATE TABLE IF NOT EXISTS app_permission (
  code varchar(80) PRIMARY KEY,
  description varchar(240) NOT NULL
);

CREATE TABLE IF NOT EXISTS app_role_permission (
  role varchar(20) NOT NULL,
  permission_code varchar(80) NOT NULL REFERENCES app_permission(code) ON DELETE CASCADE,
  PRIMARY KEY (role, permission_code),
  CONSTRAINT app_role_permission_role_chk CHECK (role IN ('admin','user'))
);

CREATE TABLE IF NOT EXISTS app_user_permission (
  id_user integer NOT NULL REFERENCES auth_user(id_user) ON DELETE CASCADE,
  permission_code varchar(80) NOT NULL REFERENCES app_permission(code) ON DELETE CASCADE,
  granted boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id_user, permission_code)
);

INSERT INTO app_permission(code,description) VALUES
 ('ventas.crear','Crear ventas y facturas internas'),
 ('ventas.cancelar','Cancelar ventas y procesar devoluciones'),
 ('ventas.descuento','Autorizar descuentos y márgenes excepcionales'),
 ('inventario.ajustar','Aplicar conteos y ajustes de inventario'),
 ('inventario.transferir','Transferir mercancía entre ubicaciones'),
 ('compras.autorizar','Autorizar solicitudes y emitir órdenes de compra'),
 ('compras.recibir','Registrar recepciones de proveedor'),
 ('credito.autorizar','Resolver excepciones de crédito'),
 ('caja.operar','Abrir y operar caja'),
 ('caja.cerrar','Cerrar turnos de caja'),
 ('contabilidad.operar','Crear y contabilizar pólizas y presupuestos'),
 ('contabilidad.cerrar_periodo','Cerrar periodos contables'),
 ('tesoreria.conciliar','Registrar y conciliar movimientos bancarios'),
 ('fiscal.timbrar','Timbrar, cancelar y consultar CFDI con PAC')
ON CONFLICT(code) DO UPDATE SET description=excluded.description;

INSERT INTO app_role_permission(role,permission_code)
SELECT 'admin',code FROM app_permission
ON CONFLICT DO NOTHING;

INSERT INTO app_role_permission(role,permission_code) VALUES
 ('user','ventas.crear'),
 ('user','inventario.transferir'),
 ('user','compras.recibir')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE app_user_permission IS 'Conceder o negar permisos por usuario; prevalece sobre el permiso heredado del rol';
