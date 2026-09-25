const { Client } = require('pg'); 
const { databaseConfig } = require('./db-config');
const client = new Client(databaseConfig());
client.connect().then(() => client.query(`SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_name = 'kardex'`).then(res => { console.log(res.rows); client.end(); }))
