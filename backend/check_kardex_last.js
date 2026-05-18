const { Client } = require('pg'); 
const client = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'F8pz6u4oi**', database: 'BD_local_Proyecto' }); 
client.connect().then(() => client.query(`SELECT f.id_factura, f.tipo_comprobante, k.tipo_movimiento, k.cantidad, k.stock_anterior, k.stock_resultante FROM factura f JOIN kardex k ON f.id_factura = k.id_referencia ORDER BY k.id_kardex DESC LIMIT 3`).then(res => { console.log(res.rows); client.end(); }))
