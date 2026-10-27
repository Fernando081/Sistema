const assert=require('node:assert/strict'),fs=require('node:fs'),{createHash}=require('node:crypto');
const{Client}=require('../node_modules/pg'),{databaseConfig}=require('../backend/db-config');
(async()=>{
 assert.equal(process.versions.node.split('.')[0],'24');const checks=[],tables={},id='00000000-0000-4000-8000-000000000001';
 for(const[url,status,headers]of[
  ['http://127.0.0.1:3100/api/v1/health',200],['http://127.0.0.1:4300/crm/reglas-secuencias',200],['http://127.0.0.1:4300/crm/secuencias',200],['http://127.0.0.1:4300/crm',200],['http://127.0.0.1:4500/',200],['http://127.0.0.1:4600/catalogo',200],['http://127.0.0.1:4500/solicitar',503],
  ['http://127.0.0.1:3100/api/v1/crm/reglas-secuencias',401],['http://127.0.0.1:3100/api/v1/crm/reglas-secuencias/'+id+'/eventos',401],['http://127.0.0.1:3100/api/v1/crm/reglas-secuencias/'+id+'/historial',401],['http://127.0.0.1:3100/api/v1/crm/reglas-secuencias',401,{Cookie:'portal_session='+('a'.repeat(43))}]
 ]){const r=await fetch(url,{headers,signal:AbortSignal.timeout(10000)});assert.equal(r.status,status,url);await r.arrayBuffer();checks.push({url,status,passed:true});}
 const db=new Client(databaseConfig());await db.connect();try{
  await db.query('BEGIN READ ONLY');for(const file of['107_crm_secuencias_internas.sql','108_crm_secuencias_control.sql','109_crm_secuencias_reglas.sql']){const migration=(await db.query('SELECT checksum FROM schema_migration WHERE filename=$1',[file])).rows[0];assert.equal(migration?.checksum,createHash('sha256').update(fs.readFileSync('backend/migrations/'+file)).digest('hex'));checks.push({name:file+' aplicada/checksum',passed:true});}
  for(const table of['crm_etapa_evento','crm_secuencia_regla','crm_secuencia_aplicacion']){tables[table]=(await db.query('SELECT count(*)::int n FROM '+table)).rows[0].n;checks.push({name:table+' registros observados',rows:tables[table],passed:true});}
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_trigger WHERE tgrelid IN('crm_etapa_evento'::regclass,'crm_secuencia_regla'::regclass,'crm_secuencia_aplicacion'::regclass) AND tgfoid='fn_crm_secuencia_conservar()'::regprocedure AND tgenabled='A' AND tgtype=58")).rows[0].n,3);checks.push({name:'Tres guardas ALWAYS',passed:true});
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_trigger WHERE tgrelid='crm_oportunidad'::regclass AND tgname='crm_etapa_evento' AND tgenabled='O'")).rows[0].n,1);checks.push({name:'Captura de eventos instalada sin backfill',passed:true});
  await db.query('ROLLBACK');
 }finally{await db.end();}
 fs.writeFileSync('.artifacts/c022b-local-status.json',JSON.stringify({passed:true,checkedAt:new Date().toISOString(),sqlReadOnly:true,tables,checks},null,2)+'\n');console.log(checks.length+' comprobaciones locales; servicios y esquema109 verificados.');
})().catch(e=>{console.error(e instanceof assert.AssertionError?e.message:e.name);process.exitCode=1;});
