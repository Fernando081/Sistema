const fs = require('fs');
const { Client } = require('pg');
const { databaseConfig } = require('./db-config');

const client = new Client(databaseConfig());
client.connect()
  .then(() => client.query(
    "SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='fn_convertir_cotizacion_a_venta'",
  ))
  .then((result) => {
    fs.writeFileSync('fn_convertir.sql', result.rows[0].pg_get_functiondef);
    return client.end();
  });
