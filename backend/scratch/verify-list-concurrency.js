const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomBytes}=require('node:crypto');const {execFileSync}=require('node:child_process');const {performance}=require('node:perf_hooks');
const {Client}=require('pg');const {databaseConfig}=require('../db-config');const {findPgTool,postgresEnvironment}=require('../backup');
const {fixtures}=require('./benchmark-lists');
const {directoryPage,DirectoryQueryDto}=require('../dist/common/directory-query');
const {facturaPage,FacturaQueryDto}=require('../dist/venta/factura-query');
const {cotizacionPage,CotizacionQueryDto}=require('../dist/cotizacion/cotizacion-query');
const {compraPage,CompraQueryDto,COMPRA_SOURCE}=require('../dist/compra/compra-query');
const {ProductoService,PRODUCT_SOURCE}=require('../dist/producto/producto.service');
const domains=['cliente','proveedor','producto','factura','cotizacion','compra'];
const cases=domains.flatMap(domain=>['','Q04TARGET','Cliente','%'].map(term=>({domain,term})));
function source(client,afterCount,snapshot=false){let chain=Promise.resolve();const executor={query(sql,params){const run=chain.then(async()=>{const result=(await client.query(sql.replace(PRODUCT_SOURCE,'(SELECT * FROM q04_load.fixture_products)').replace(COMPRA_SOURCE,'(SELECT * FROM q04_load.fixture_compras)'),params)).rows;if(afterCount&&/^SELECT count\(/i.test(sql))await afterCount();return result;});chain=run.catch(()=>{});return run;}};if(snapshot)executor.transaction=async(isolation,work)=>{assert.equal(isolation,'REPEATABLE READ');await chain;await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');try{const result=await work(source(client,afterCount,false));await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}};return executor;}
async function read(executor,{domain,term}){
 if(domain==='cliente'||domain==='proveedor')return directoryPage(executor,domain,Object.assign(new DirectoryQueryDto(),{term}));
 if(domain==='factura')return facturaPage(executor,Object.assign(new FacturaQueryDto(),{term}));
 if(domain==='cotizacion')return cotizacionPage(executor,Object.assign(new CotizacionQueryDto(),{term}));
 if(domain==='compra')return compraPage(executor,Object.assign(new CompraQueryDto(),{term}));
 return new ProductoService(executor).findAll(1,10,'','',term);
}
function percentile(samples,p){const a=[...samples].sort((a,b)=>a-b);return a[Math.max(0,Math.ceil(a.length*p)-1)];}
async function main(){const arg=process.argv.find(x=>x.startsWith('--backup='));assert.ok(arg,'Falta --backup=RUTA');const root=path.resolve(__dirname,'../../.backups'),dump=path.resolve(arg.slice(9));assert.ok(dump.startsWith(root+path.sep)&&fs.existsSync(dump));
 const base=databaseConfig(),admin=new Client(base),name=`sistema_load_${Date.now()}_${randomBytes(3).toString('hex')}`;assert.match(name,/^sistema_load_\d+_[a-f0-9]{6}$/);let created=false,setup;const clients=[];let report;await admin.connect();
 const options={...base,database:name};if(base.connectionString){const u=new URL(base.connectionString);u.pathname='/'+name;options.connectionString=u.toString();}
 async function connect(){const c=new Client(options);await c.connect();clients.push(c);await c.query("SET search_path=q04_load,public;SET statement_timeout='15s';SET lock_timeout='2s'");assert.equal((await c.query('SELECT current_database() name')).rows[0].name,name);return c;}
 try{assert.notEqual(name,(await admin.query('SELECT current_database() name')).rows[0].name);await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);created=true;
 const env={...postgresEnvironment(),DB_NAME:name,PGDATABASE:name};if(options.connectionString)env.DATABASE_URL=options.connectionString;else delete env.DATABASE_URL;const child={env,windowsHide:true,stdio:'pipe',timeout:180000,cwd:path.resolve(__dirname,'..')};
 execFileSync(findPgTool('pg_restore'),['--exit-on-error','--no-owner','--no-acl','--dbname',name,dump],child);execFileSync(process.execPath,[path.join(__dirname,'../run-migrations.js'),'--check'],child);execFileSync(process.execPath,[path.join(__dirname,'../run-migrations.js')],child);
 setup=await connect();await setup.query('CREATE SCHEMA q04_load');await fixtures(setup,20000,true);await setup.query('COMMIT');
 const expected=[];for(const test of cases)expected.push(await read(source(setup),test));
 const groups=[];
 for(const concurrency of [1,4,8]){const workers=[];for(let n=0;n<concurrency;n++)workers.push(await connect());const samples=[],byDomain=Object.fromEntries(domains.map(d=>[d,[]]));let requests=0;const start=performance.now();
 const results=await Promise.allSettled(workers.map(async(c,worker)=>{const executor=source(c,null,process.argv.includes('--snapshots'));let round=0;while(performance.now()-start<6000&&round<512){const index=(round*concurrency+worker)%cases.length,test=cases[index],at=performance.now();assert.deepEqual(await read(executor,test),expected[index],`${test.domain}: resultado divergente`);const ms=performance.now()-at;samples.push(ms);byDomain[test.domain].push(ms);requests++;round++;}}));for(const result of results)if(result.status==='rejected')throw result.reason;
 const elapsedMs=performance.now()-start;groups.push({concurrency,requests,elapsedMs,requestsPerSecond:requests/(elapsedMs/1000),p50Ms:percentile(samples,.5),p95Ms:percentile(samples,.95),maxMs:Math.max(...samples),domains:Object.fromEntries(domains.map(d=>[d,{requests:byDomain[d].length,p95Ms:byDomain[d].length?percentile(byDomain[d],.95):null}]))});
 for(const c of workers){await c.end();clients.splice(clients.indexOf(c),1);}}
 const writer=await connect();let inserted=false;
 const race=await directoryPage(source(setup,async()=>{if(!inserted){inserted=true;await writer.query(`INSERT INTO cliente VALUES(40001,'RFC-RACE','Q04CONSISTENCY','89000')`);}}),'cliente',Object.assign(new DirectoryQueryDto(),{term:'Q04CONSISTENCY'}));
 assert.equal(race.total,0);assert.equal(race.data.length,1);await writer.query('DELETE FROM cliente WHERE "IdCliente"=40001');
 await setup.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');inserted=false;
 const snapshot=await directoryPage(source(setup,async()=>{if(!inserted){inserted=true;await writer.query(`INSERT INTO cliente VALUES(40002,'RFC-RACE','Q04CONSISTENCY','89000')`);}}),'cliente',Object.assign(new DirectoryQueryDto(),{term:'Q04CONSISTENCY'}));
 assert.equal(snapshot.total,0);assert.equal(snapshot.data.length,0);await setup.query('ROLLBACK');
 report={generatedAt:new Date().toISOString(),node:process.versions.node,snapshotLoad:process.argv.includes('--snapshots'),fixtureRowsPerDomain:20000,warmupCases:cases.length,groups,consistency:{readCommitted:{total:race.total,rows:race.data.length},repeatableRead:{total:snapshot.total,rows:snapshot.data.length}},limitations:['Carga cerrada y acotada, hasta 6 s o 512 solicitudes por lector/grupo; no certifica carga sostenida de producción.','Métodos de aplicación con proyección sintética de productos/compras, sin HTTP/autenticación/UI ni escrituras concurrentes de negocio.','Conexión por lector serializa consultas internas; concurrency expresa lectores, no usuarios reales.','La prueba determinista de escritura cubre cliente, no todos los flujos de negocio.','P95 orientativo y caché caliente; sin WAL/autovacuum/CPU ni SLA.']};
 }finally{for(const c of clients)await c.end();if(created){assert.match(name,/^sistema_load_\d+_[a-f0-9]{6}$/);await admin.query(`DROP DATABASE "${name}"`);}await admin.end();}
 fs.writeFileSync(path.join(__dirname,process.argv.includes('--snapshots')?'../../docs/q0453b-concurrency.json':'../../docs/q0453a-concurrency.json'),JSON.stringify(report,null,2)+'\n');console.table(report.groups.map(({concurrency,requests,elapsedMs,p50Ms,p95Ms,maxMs})=>({concurrency,requests,elapsedMs,p50Ms,p95Ms,maxMs})));console.log('Resultados equivalentes; carrera READ COMMITTED reproducida y snapshot probado; base aislada eliminada.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
