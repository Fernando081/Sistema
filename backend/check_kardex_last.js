const { Client } = require('pg'); 
const { databaseConfig } = require('./db-config');
const client = new Client(databaseConfig());
client.connect().then(() => client.query(`SELECT f.id_factura, f.tipo_comprobante, k.tipo_movimiento, k.cantidad, k.stock_anterior, k.stock_resultante FROM factura f JOIN kardex k ON f.id_factura = k.id_referencia ORDER BY k.id_kardex DESC LIMIT 3`).then(res => { console.log(res.rows); client.end(); }))
