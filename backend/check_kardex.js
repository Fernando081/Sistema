const { Client } = require('pg'); 
const client = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'F8pz6u4oi**', database: 'BD_local_Proyecto' }); 
client.connect().then(() => client.query(`SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_name = 'kardex'`).then(res => { console.log(res.rows); client.end(); }))
