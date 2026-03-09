module.exports = {
  up: async (client) => {
    // Tabla Principal del REP
    await client.query(`
      CREATE TABLE IF NOT EXISTS rep (
        id_rep SERIAL PRIMARY KEY,
        id_cliente INTEGER NOT NULL REFERENCES cliente("IdCliente"),
        fecha_pago TIMESTAMP WITH TIME ZONE NOT NULL,
        forma_pago VARCHAR(50) NOT NULL,
        moneda VARCHAR(5) NOT NULL DEFAULT 'MXN',
        monto_total NUMERIC(12, 2) NOT NULL,
        cuenta_beneficiario VARCHAR(50),
        rfc_beneficiario VARCHAR(20),
        
        -- Datos Fiscales CFDI 4.0
        uuid UUID,
        no_serie_certificado VARCHAR(50),
        no_certificado_emisor VARCHAR(50),
        lugar_emision VARCHAR(10),
        fecha_emision TIMESTAMP WITH TIME ZONE,
        sello_sat TEXT,
        sello_cfdi TEXT,
        cadena_original TEXT,
        
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Tabla de Desglose de Facturas Pagadas en el REP
    await client.query(`
      CREATE TABLE IF NOT EXISTS rep_factura (
        id_rep_factura SERIAL PRIMARY KEY,
        id_rep INTEGER NOT NULL REFERENCES rep(id_rep) ON DELETE CASCADE,
        id_factura INTEGER NOT NULL REFERENCES factura(id_factura),
        num_parcialidad INTEGER NOT NULL DEFAULT 1,
        saldo_anterior NUMERIC(12, 2) NOT NULL,
        monto_pagado NUMERIC(12, 2) NOT NULL,
        saldo_insoluto NUMERIC(12, 2) NOT NULL,
        impuestos_retenidos NUMERIC(12, 2) DEFAULT 0,
        impuestos_trasladados NUMERIC(12, 2) DEFAULT 0
      );
    `);
  },

  down: async (client) => {
    await client.query('DROP TABLE IF EXISTS rep_factura;');
    await client.query('DROP TABLE IF EXISTS rep;');
  }
};
