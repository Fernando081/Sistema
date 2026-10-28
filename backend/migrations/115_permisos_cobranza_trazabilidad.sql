-- H02-a: rutas de escritura que aceptaban cualquier sesión pasan a exigir permiso.
-- Se conceden a admin y user para conservar el acceso actual; negables por usuario/perfil (S01).
INSERT INTO app_permission(code,description) VALUES
 ('cobranza.registrar','Registrar cobros de clientes y complementos de pago (REP)'),
 ('inventario.trazabilidad','Registrar lotes, series y cascos recuperables')
ON CONFLICT(code) DO UPDATE SET description=excluded.description;
INSERT INTO app_role_permission(role,permission_code) VALUES
 ('admin','cobranza.registrar'),('admin','inventario.trazabilidad'),
 ('user','cobranza.registrar'),('user','inventario.trazabilidad')
ON CONFLICT DO NOTHING;
