CREATE TABLE web_producto_ficha (
  id_producto integer PRIMARY KEY REFERENCES producto("IdProducto") ON DELETE CASCADE,
  slug varchar(160) NOT NULL UNIQUE CHECK(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  titulo varchar(160) NOT NULL,
  descripcion text NOT NULL,
  estado text NOT NULL DEFAULT 'borrador' CHECK(estado IN ('borrador','listo','retirado')),
  datos_reales_confirmados boolean NOT NULL DEFAULT false,
  derechos_imagen_confirmados boolean NOT NULL DEFAULT false,
  compatibilidad_verificada boolean NOT NULL DEFAULT false,
  snapshot jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  updated_by integer NOT NULL REFERENCES auth_user(id_user),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(estado<>'listo' OR (datos_reales_confirmados AND derechos_imagen_confirmados AND compatibilidad_verificada))
);
CREATE INDEX idx_web_producto_estado ON web_producto_ficha(estado,id_producto);
