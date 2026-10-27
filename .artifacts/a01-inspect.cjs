const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {Client}=require('../node_modules/pg'),{databaseConfig}=require('../backend/db-config');
(async()=>{const c=new Client(databaseConfig()),report={phase:'A01.1'};await c.connect();try{
 const file='111_almacen_escaneo_picking.sql',hash=crypto.createHash('sha256').update(fs.readFileSync('backend/migrations/'+file)).digest('hex');
 assert.equal((await c.query('SELECT checksum FROM schema_migration WHERE filename=$1',[file])).rows[0].checksum,hash);report.migration111Checksum=true;
 report.sourceVerifications=(await c.query('SELECT count(*)::int n FROM almacen_picking_verificacion')).rows[0].n;assert.equal(report.sourceVerifications,0);
 report.pendingCopies=(await c.query("SELECT count(*)::int n FROM pg_database WHERE datname ~ '^verify_mobile_[a-f0-9]{16}$'")).rows[0].n;assert.equal(report.pendingCopies,0);
 report.defaultRoles=(await c.query("SELECT role FROM app_role_permission WHERE permission_code='inventario.escanear' ORDER BY role")).rows.map(r=>r.role);assert.deepEqual(report.defaultRoles,['admin']);
 report.http=[];for(const[url,status]of[['http://127.0.0.1:3100/api/v1/health',200],['http://127.0.0.1:3100/api/v1/almacen/movil/pedidos',401],['http://127.0.0.1:4300/almacen/movil',200],['http://127.0.0.1:4500/',200],['http://127.0.0.1:4500/solicitar',503],['http://127.0.0.1:4600/',200]]){const r=await fetch(url,{signal:AbortSignal.timeout(10000)});assert.equal(r.status,status,url);await r.body?.cancel();report.http.push({url,status});}
 report.passed=true;fs.writeFileSync('.artifacts/a01-source-status.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await c.end();}})().catch(e=>{console.error(e.name,e instanceof assert.AssertionError?e.message:'Verificación local fallida');process.exitCode=1;});
