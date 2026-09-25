const { Client } = require('pg'); 
const { databaseConfig } = require('./db-config');
const client = new Client(databaseConfig());
client.connect().then(() => client.query(`SELECT trigger_name, event_object_table FROM information_schema.triggers WHERE trigger_schema = 'public'`).then(res => { console.log(res.rows); client.end(); }))
