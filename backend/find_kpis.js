const { Client } = require('pg'); 
const { databaseConfig } = require('./db-config');
const client = new Client(databaseConfig());
client.connect().then(() => client.query(`SELECT proname FROM pg_proc WHERE proname LIKE '%kpi%' OR proname LIKE '%comision%' OR proname LIKE '%dash%' OR proname LIKE '%venta%'`).then(res => { console.log("FUNCTIONS:", res.rows.map(r=>r.proname)); client.query(`SELECT table_name FROM information_schema.views WHERE table_schema='public'`).then(res2 => { console.log("VIEWS:", res2.rows.map(r=>r.table_name)); client.end();})}))
