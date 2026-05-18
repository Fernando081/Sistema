const { Client } = require('pg'); 
const client = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'F8pz6u4oi**', database: 'BD_local_Proyecto' }); 
client.connect().then(() => client.query(`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'tipo_movimiento_enum'`).then(res => { console.log(res.rows); client.end(); }))
