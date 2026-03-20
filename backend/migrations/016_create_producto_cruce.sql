-- 016_create_producto_cruce.sql

CREATE TABLE IF NOT EXISTS producto_cruce (
    id_producto_origen INT NOT NULL,
    id_producto_destino INT NOT NULL,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_producto_cruce PRIMARY KEY (id_producto_origen, id_producto_destino),
    CONSTRAINT fk_prodcruce_origen FOREIGN KEY (id_producto_origen) REFERENCES producto("IdProducto") ON DELETE CASCADE,
    CONSTRAINT fk_prodcruce_destino FOREIGN KEY (id_producto_destino) REFERENCES producto("IdProducto") ON DELETE CASCADE,
    CONSTRAINT chk_different_products CHECK (id_producto_origen != id_producto_destino)
);

-- Indices for fast bidirectional lookups
CREATE INDEX IF NOT EXISTS idx_prodcruce_origen ON producto_cruce(id_producto_origen);
CREATE INDEX IF NOT EXISTS idx_prodcruce_destino ON producto_cruce(id_producto_destino);

-- We might also insert a couple of mock cross-references to test later if we knew some IDs. 
-- For now, the table is ready.
