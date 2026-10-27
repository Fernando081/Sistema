const {Client}=require('pg');
const {databaseConfig}=require('../backend/db-config');
(async()=>{const c=new Client(databaseConfig());await c.connect();try{
await c.query('BEGIN READ ONLY');
const r=await c.query(`SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public'
AND table_name=ANY($1) AND column_name~'(cliente|id_factura|id_pedido|id_cotizacion|folio|estatus|tipo_comprobante|fecha_emision|serie|estado|version)' ORDER BY table_name,ordinal_position`,
[['cotizacion','factura','pedido_venta','fiscal_documento','crm_oportunidad']]);console.log(JSON.stringify(r.rows));
await c.query('ROLLBACK');}finally{await c.end();}})().catch(e=>{console.error(e.name,'Comprobación no completada');process.exitCode=1;});
