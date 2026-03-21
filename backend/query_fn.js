const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto' });

client.connect()
  .then(() => client.query("SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND proname = 'fn_crear_venta'"))
  .then((res) => {
    console.log(res.rows[0].pg_get_functiondef);
    process.exit(0);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
