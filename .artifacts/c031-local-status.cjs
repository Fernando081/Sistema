require('reflect-metadata');
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{databaseConfig}=require('../backend/db-config');
const {CrmBandejaService}=require('../backend/dist/crm/crm-bandeja.service');
(async()=>{const report={phase:'C03.1',checkedAt:new Date().toISOString(),checks:[]},db=new Client(databaseConfig());await db.connect();try{
 for(const[url,status]of[['http://127.0.0.1:3100/api/v1/crm/bandeja',401],['http://127.0.0.1:4300/crm/bandeja',200],['http://127.0.0.1:4500/',200],['http://127.0.0.1:4600/',200],['http://127.0.0.1:4500/solicitar',503]]){const r=await fetch(url,{signal:AbortSignal.timeout(12000)});assert.equal(r.status,status);report.checks.push({url,status:r.status});await r.body?.cancel();}
 await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const actor=(await db.query("SELECT id_user AS \"idUser\",role,token_version AS version FROM auth_user WHERE is_active AND role='admin' ORDER BY id_user LIMIT 1")).rows[0];assert.ok(actor);
 const api=new CrmBandejaService({query:async(sql,params)=>(await db.query(sql,params)).rows});
 const r=await api.list({page:1,q:'',tipo:'todos',plazo:'todos'},actor);assert.equal(r.administrador,true);assert.ok(r.data.length<=20);assert.ok(r.total>=r.data.length);assert.ok(r.data.every(i=>typeof i.id==='string'));report.checks.push({name:'Consulta real local de sólo lectura',total:r.total,rows:r.data.length,resumen:r.resumen});
 const fixture=(await db.query("SELECT count(*)::int n FROM crm_tarea WHERE titulo LIKE 'C031-%'")).rows[0].n;assert.equal(fixture,0);report.checks.push({name:'Sin fixtures de aceptación en origen',fixtures:fixture});await db.query('COMMIT');
 const copies=(await db.query("SELECT count(*)::int n FROM pg_database WHERE datname LIKE 'verify_inbox_%'")).rows[0].n;assert.equal(copies,0);report.checks.push({name:'Sin copias de aceptación restantes',copies});report.passed=true;fs.writeFileSync('C:/Sistema/.artifacts/c031-local-status.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 }finally{await db.end();}})().catch(e=>{console.error('Verificación local falló:',e.name,e.code??'');process.exitCode=1;});
