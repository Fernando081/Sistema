-- H01: surtir y cancelar pedidos dejan de ser acciones abiertas a cualquier sesión.
-- Se conceden a admin y user para conservar el comportamiento actual; ahora pueden
-- negarse por usuario o perfil (S01) sin tocar otras operaciones de pedidos.
INSERT INTO app_permission(code,description) VALUES
 ('pedidos.surtir','Surtir pedidos y apartar mercancía de ubicaciones'),
 ('pedidos.cancelar','Cancelar pedidos y liberar sus reservas')
ON CONFLICT(code) DO UPDATE SET description=excluded.description;
INSERT INTO app_role_permission(role,permission_code) VALUES
 ('admin','pedidos.surtir'),('admin','pedidos.cancelar'),
 ('user','pedidos.surtir'),('user','pedidos.cancelar')
ON CONFLICT DO NOTHING;
