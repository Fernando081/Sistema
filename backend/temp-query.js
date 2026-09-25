const { Client } = require('pg');
const { databaseConfig } = require('./db-config');
const c = new Client(databaseConfig());
c.connect()
  .then(() => c.query('SELECT "IdProducto", "Codigo", "Existencia", "Descripcion" FROM producto LIMIT 20'))
  .then(res => {
     console.table(res.rows);
     c.end();
  })
  .catch(err => {
     console.error(err);
     c.end();
  });
