const { Client } = require('pg'); 
const client = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'F8pz6u4oi**', database: 'BD_local_Proyecto' }); 
client.connect().then(() => client.query(`SELECT pg_get_functiondef(oid) as def FROM pg_proc WHERE proname IN ('fn_get_comisiones_semanales', 'fn_get_dashboard_metrics')`).then(res => { console.log(res.rows.map(r=>r.def).join('\n\n')); client.end(); }))
