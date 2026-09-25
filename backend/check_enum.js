const { Client } = require('pg'); 
const { databaseConfig } = require('./db-config');
const client = new Client(databaseConfig());
client.connect().then(() => client.query(`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'tipo_movimiento_enum'`).then(res => { console.log(res.rows); client.end(); }))
