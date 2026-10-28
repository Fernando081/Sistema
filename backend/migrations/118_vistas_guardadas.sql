-- U02.2 (28/10/2026) · Vistas guardadas por usuario: filtros de un listado con nombre propio.
-- Sólo guarda parámetros de consulta ya validados por el servidor; nunca datos del listado.
CREATE TABLE vista_guardada (
  id_vista bigserial PRIMARY KEY,
  id_user integer NOT NULL REFERENCES auth_user(id_user) ON DELETE CASCADE,
  ruta varchar(40) NOT NULL CHECK (ruta IN ('/cliente','/proveedor','/producto','/facturas','/cotizacion/historial','/compra/historial')),
  nombre varchar(60) NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 60),
  consulta varchar(1000) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX ux_vista_guardada_nombre ON vista_guardada(id_user, ruta, lower(nombre));
CREATE INDEX idx_vista_guardada_usuario_ruta ON vista_guardada(id_user, ruta, nombre);
