const { Client } = require('pg'); 
const { databaseConfig } = require('./db-config');
const client = new Client(databaseConfig());
client.connect().then(() => client.query(`SELECT pg_get_functiondef(oid) as def FROM pg_proc WHERE proname IN ('fn_get_comisiones_semanales', 'fn_get_dashboard_metrics')`).then(res => { console.log(res.rows.map(r=>r.def).join('\n\n')); client.end(); }))
