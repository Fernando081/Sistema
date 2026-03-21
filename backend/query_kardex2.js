const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto' });

client.connect()
  .then(() => client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'kardex'"))
  .then((res) => {
    console.log(res.rows.map((r,i) => i + ': ' + r.column_name).join('\n'));
    process.exit(0);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
