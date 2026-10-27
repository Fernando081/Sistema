const assert=require('node:assert/strict'),fs=require('node:fs'),{createHash}=require('node:crypto');
const {Client}=require('../node_modules/pg'),{databaseConfig}=require('../backend/db-config');
(async()=>{
 assert.equal(process.versions.node.split('.')[0],'24');const checks=[];
 for(const[url,status,headers]of[
  ['http://127.0.0.1:3100/api/v1/health',200],['http://127.0.0.1:4300/crm/campanas',200],['http://127.0.0.1:4300/cliente',200],['http://127.0.0.1:4300/portal',200],['http://127.0.0.1:4500/',200],['http://127.0.0.1:4600/catalogo',200],['http://127.0.0.1:4500/solicitar',503],
  ['http://127.0.0.1:3100/api/v1/crm/campanas-locales',401],['http://127.0.0.1:3100/api/v1/crm/campanas-locales/1/destinatarios',401],
  ['http://127.0.0.1:3100/api/v1/clientes/1/consentimiento-comercial',401],['http://127.0.0.1:3100/api/v1/clientes/1/consentimiento-comercial/historial',401],
  ['http://127.0.0.1:3100/api/v1/crm/campanas-locales',401,{Cookie:'portal_session='+('a'.repeat(43))}],
  ['http://127.0.0.1:3100/api/v1/portal/archivos',401,{'X-Portal-Browser':'1',Origin:'http://127.0.0.1:4300'}],
 ]){const response=await fetch(url,{headers,signal:AbortSignal.timeout(10000)});assert.equal(response.status,status,url);await response.arrayBuffer();checks.push({url,status,passed:true});}
 const db=new Client(databaseConfig()),tables={};await db.connect();try{
  await db.query('BEGIN READ ONLY');const migration=(await db.query("SELECT checksum FROM schema_migration WHERE filename='106_crm_consentimiento_campanas.sql'")).rows[0];
  assert.equal(migration?.checksum,createHash('sha256').update(fs.readFileSync('backend/migrations/106_crm_consentimiento_campanas.sql')).digest('hex'));checks.push({name:'106 aplicada con checksum vigente',passed:true});
  for(const table of['crm_consentimiento_comercial','crm_campana_preparacion']){tables[table]=(await db.query('SELECT count(*)::int n FROM '+table)).rows[0].n;checks.push({name:table+' registros observados',rows:tables[table],passed:true});}
  assert.equal((await db.query("SELECT count(*)::int n FROM app_role_permission WHERE role='admin' AND permission_code='crm.campanas.gestionar'")).rows[0].n,1);checks.push({name:'Permiso ADMIN inicial',passed:true});
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_trigger WHERE tgrelid IN('crm_consentimiento_comercial'::regclass,'crm_campana_preparacion'::regclass) AND tgfoid='fn_crm_campana_conservar()'::regprocedure AND tgenabled='A' AND tgtype=58")).rows[0].n,2);checks.push({name:'Guardas ALWAYS de conservación',passed:true});
  await db.query('ROLLBACK');
 }finally{await db.end();}
 fs.writeFileSync('.artifacts/c01-local-status.json',JSON.stringify({passed:true,checkedAt:new Date().toISOString(),sqlReadOnly:true,tables,checks},null,2)+'\n');console.log(checks.length+' comprobaciones locales; tablas nuevas: '+Object.values(tables).join('/')+' registros.');
})().catch(e=>{console.error(e instanceof assert.AssertionError?e.message:e.name);process.exitCode=1;});
