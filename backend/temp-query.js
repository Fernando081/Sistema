const { Client } = require('pg');
const c = new Client({
  host: '127.0.0.1',
  port: 5432,
  user: 'postgres',
  password: 'F8pz6u4oi**',
  database: 'BD_local_Proyecto'
});
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
