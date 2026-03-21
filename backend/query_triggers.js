const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto' });

client.connect()
  .then(() => client.query("SELECT tgname, relname AS table_name FROM pg_trigger t JOIN pg_class c ON t.tgrelid = c.oid WHERE relname IN ('gasto', 'cliente', 'kardex', 'producto', 'devolucion', 'devolucion_detalle')"))
  .then((res) => {
    console.log(res.rows);
    process.exit(0);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
