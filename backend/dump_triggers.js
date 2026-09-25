const { Client } = require('pg'); 
const { databaseConfig } = require('./db-config');
const client = new Client(databaseConfig());
client.connect().then(() => client.query(`SELECT trigger_name, action_statement FROM information_schema.triggers WHERE event_object_table = 'conceptofactura'`).then(res => { console.log(res.rows); client.end(); }))
