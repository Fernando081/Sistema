const { Client } = require('pg'); 
const { databaseConfig } = require('./db-config');
const client = new Client(databaseConfig());
client.connect().then(() => client.query(`SELECT pg_get_functiondef(oid) as def FROM pg_proc WHERE proname = 'fn_get_facturas'`).then(res => { console.log(res.rows[0].def); client.end(); }))
