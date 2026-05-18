const { Client } = require('pg'); 
const client = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'F8pz6u4oi**', database: 'BD_local_Proyecto' }); 
client.connect().then(() => client.query(`SELECT prosrc FROM pg_proc WHERE proname = 'fn_kardex_venta'`).then(res => { console.log(res.rows[0].prosrc); client.end(); }))
