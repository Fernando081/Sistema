const { Client } = require('pg'); 
const client = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'F8pz6u4oi**', database: 'BD_local_Proyecto' }); 
client.connect().then(() => client.query(`SELECT trigger_name, action_statement FROM information_schema.triggers WHERE event_object_table = 'conceptofactura'`).then(res => { console.log(res.rows); client.end(); }))
