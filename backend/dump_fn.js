const { Client } = require('pg'); 
const { databaseConfig } = require('./db-config');
const client = new Client(databaseConfig());
client.connect().then(() => client.query(`SELECT prosrc FROM pg_proc WHERE proname = 'fn_kardex_venta'`).then(res => { console.log(res.rows[0].prosrc); client.end(); }))
