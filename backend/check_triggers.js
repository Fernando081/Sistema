const { Client } = require('pg'); 
const { databaseConfig } = require('./db-config');
const client = new Client(databaseConfig());
client.connect().then(() => client.query(`SELECT trigger_name, event_manipulation, event_object_table, action_statement FROM information_schema.triggers WHERE event_object_table IN ('factura', 'conceptofactura', 'pago', 'devolucion', 'devolucion_detalle')`).then(res => { console.log(res.rows); client.end(); }))
