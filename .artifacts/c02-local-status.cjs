const assert=require('node:assert/strict'),fs=require('node:fs'),{createHash}=require('node:crypto');
const{Client}=require('../node_modules/pg'),{databaseConfig}=require('../backend/db-config');
(async()=>{
 assert.equal(process.versions.node.split('.')[0],'24');const checks=[],tables={};
 for(const[url,status,headers]of[
  ['http://127.0.0.1:3100/api/v1/health',200],['http://127.0.0.1:4300/crm/secuencias',200],['http://127.0.0.1:4300/crm/campanas',200],['http://127.0.0.1:4300/crm',200],['http://127.0.0.1:4300/portal',200],
  ['http://127.0.0.1:4500/',200],['http://127.0.0.1:4600/catalogo',200],['http://127.0.0.1:4500/solicitar',503],
  ['http://127.0.0.1:3100/api/v1/crm/secuencias',401],['http://127.0.0.1:3100/api/v1/crm/secuencias/modelos',401],['http://127.0.0.1:3100/api/v1/crm/secuencias/clientes',401],
  ['http://127.0.0.1:3100/api/v1/crm/secuencias',401,{Cookie:'portal_session='+('a'.repeat(43))}]
 ]){const response=await fetch(url,{headers,signal:AbortSignal.timeout(10000)});assert.equal(response.status,status,url);await response.arrayBuffer();checks.push({url,status,passed:true});}
 const db=new Client(databaseConfig());await db.connect();try{
  await db.query('BEGIN READ ONLY');const name='107_crm_secuencias_internas.sql',migration=(await db.query('SELECT checksum FROM schema_migration WHERE filename=$1',[name])).rows[0];assert.equal(migration?.checksum,createHash('sha256').update(fs.readFileSync('backend/migrations/'+name)).digest('hex'));checks.push({name:'107 aplicada y checksum coincide',passed:true});
  for(const table of['crm_secuencia_modelo','crm_secuencia','crm_secuencia_evento']){tables[table]=(await db.query('SELECT count(*)::int n FROM '+table)).rows[0].n;assert.equal(tables[table],0);checks.push({name:table+' sin fixtures en origen',passed:true});}
  assert.equal((await db.query('SELECT count(*)::int n FROM crm_tarea WHERE id_secuencia IS NOT NULL')).rows[0].n,0);checks.push({name:'Tareas existentes no inscritas automáticamente',passed:true});
  assert.equal((await db.query("SELECT count(*)::int n FROM app_role_permission WHERE role='admin' AND permission_code='crm.secuencias.gestionar'")).rows[0].n,1);checks.push({name:'Permiso ADMIN inicial',passed:true});
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_trigger WHERE tgrelid IN('crm_secuencia_modelo'::regclass,'crm_secuencia_evento'::regclass) AND tgfoid='fn_crm_secuencia_conservar()'::regprocedure AND tgenabled='A' AND tgtype=58")).rows[0].n,2);checks.push({name:'Conservación ALWAYS',passed:true});await db.query('ROLLBACK');
 }finally{await db.end();}
 fs.writeFileSync('.artifacts/c02-local-status.json',JSON.stringify({passed:true,checkedAt:new Date().toISOString(),sqlReadOnly:true,tables,checks},null,2)+'\n');console.log(checks.length+' comprobaciones locales; tablas nuevas vacías y servicios disponibles.');
})().catch(e=>{console.error(e instanceof assert.AssertionError?e.message:e.name);process.exitCode=1;});
