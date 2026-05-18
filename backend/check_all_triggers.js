const { Client } = require('pg'); 
const client = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'F8pz6u4oi**', database: 'BD_local_Proyecto' }); 
client.connect().then(() => client.query(`SELECT trigger_name, event_object_table FROM information_schema.triggers WHERE trigger_schema = 'public'`).then(res => { console.log(res.rows); client.end(); }))
