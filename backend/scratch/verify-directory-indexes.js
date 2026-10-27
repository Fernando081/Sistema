const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');const {execFileSync}=require('node:child_process');const {performance}=require('node:perf_hooks');
const {Client}=require('pg');const {databaseConfig}=require('../db-config');const {findPgTool,postgresEnvironment}=require('../backup');
const {directoryPage,directoryCsv,DirectoryQueryDto}=require('../dist/common/directory-query');const {csvDocument}=require('../dist/common/csv');
function legacySql(domain,q) {
 const id=domain==='cliente'?'IdCliente':'IdProveedor';const cols={id,rfc:'RFC',razonSocial:'RazonSocial',codigoPostal:'CodigoPostal'};
 const units=domain==='cliente'?` OR EXISTS (SELECT 1 FROM crm_unidad_cliente u WHERE u.id_cliente=d."IdCliente" AND strpos(lower(concat_ws(' ',u.vin,u.esn,u.numero_economico,u.placas)),lower($1))>0)`:'';
 return {id,from:`FROM ${domain} d WHERE ($1='' OR strpos(lower(concat_ws(' ',d."${id}"::text,d."RFC",d."RazonSocial",d."CodigoPostal")),lower($1))>0 ${units})`,order:`ORDER BY d."${cols[q.sortBy]}" ${q.sortOrder==='asc'?'ASC':'DESC'},d."${id}" DESC`};
}
async function legacyPage(db,domain,q) {const {from,order}=legacySql(domain,q);const total=Number((await db.query(`SELECT count(*) total ${from}`,[q.term.trim()])).rows[0].total);return {data:(await db.query(`SELECT d.* ${from} ${order} LIMIT $2 OFFSET $3`,[q.term.trim(),q.limit,(q.page-1)*q.limit])).rows,total,page:q.page,totalPages:Math.ceil(total/q.limit)};}
async function legacyCsv(db,domain,q) {const {id,from,order}=legacySql(domain,q);const rows=(await db.query(`SELECT d.* ${from} ${order} LIMIT 5001`,[q.term.trim()])).rows;if(rows.length>5000)throw new Error('La exportación supera 5000 registros. Reduce la búsqueda y vuelve a exportar.');return csvDocument([id,'RFC','RazonSocial','CodigoPostal'],rows);}
async function outcome(work) {try{return {value:await work()}}catch(error){return {error:error.message}}}
function nodes(node,out={}){out[node['Node Type']]=(out[node['Node Type']]||0)+1;for(const child of node.Plans||[])nodes(child,out);return out;}
async function timing(db,sql,params){const samples=[];for(let n=0;n<5;n++){let ms=0,tree={};for(const stmt of (Array.isArray(sql)?sql:[{sql,params}])){const p=(await db.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+stmt.sql,stmt.params)).rows[0]['QUERY PLAN'][0];ms+=p['Execution Time'];for(const [key,value] of Object.entries(nodes(p.Plan)))tree[key]=(tree[key]||0)+value;}samples.push({ms,nodes:tree});}samples.sort((a,b)=>a.ms-b.ms);return {medianMs:samples[2].ms,samplesMs:samples.map(s=>s.ms),nodes:samples[2].nodes};}
async function main(){
 const root=path.resolve(__dirname,'../../.backups');const arg=process.argv.find(x=>x.startsWith('--backup='));if(!arg)throw new Error('Falta --backup=RUTA del database.dump');const dump=path.resolve(arg.slice(9));assert.ok(dump.startsWith(root+path.sep)&&fs.existsSync(dump));
 const base=databaseConfig(),admin=new Client(base),name=`sistema_directory_verify_${Date.now()}_${randomBytes(3).toString('hex')}`;assert.match(name,/^sistema_directory_verify_\d+_[a-f0-9]{6}$/);let db,created=false,report;
 await admin.connect();try{
  assert.notEqual(name,(await admin.query('SELECT current_database() name')).rows[0].name);await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);created=true;
  const env={...postgresEnvironment(),DB_NAME:name,PGDATABASE:name};if(base.connectionString){const url=new URL(base.connectionString);url.pathname='/'+name;env.DATABASE_URL=url.toString();}else delete env.DATABASE_URL;
  const options={env,windowsHide:true,stdio:'pipe',timeout:180000,cwd:path.resolve(__dirname,'..')};
  execFileSync(findPgTool('pg_restore'),['--exit-on-error','--no-owner','--no-acl','--dbname',name,dump],options);
  execFileSync(process.execPath,[path.join(__dirname,'../run-migrations.js'),'--check'],options);execFileSync(process.execPath,[path.join(__dirname,'../run-migrations.js')],options);
  db=new Client(base.connectionString?{...base,connectionString:env.DATABASE_URL}:{...base,database:name});await db.connect();assert.equal((await db.query('SELECT current_database() name')).rows[0].name,name);await db.query("SET statement_timeout='30s'");
  const source={query:async(sql,params)=>(await db.query(sql,params)).rows};const query=v=>Object.assign(new DirectoryQueryDto(),v);let comparisons=0;
  async function compare(terms){for(const domain of ['cliente','proveedor'])for(const term of terms)for(const values of [{term},{term,page:2,limit:1,sortBy:'razonSocial',sortOrder:'asc'}]){const q=query(values);assert.deepEqual(await directoryPage(source,domain,q),await legacyPage(db,domain,q));assert.deepEqual(await outcome(()=>directoryCsv(source,domain,q)),await outcome(()=>legacyCsv(db,domain,q)));comparisons+=2;}}
  await db.query('BEGIN READ ONLY');await compare(['','%','_','\\','Diesel','VIN','ESN','  ']);await db.query('ROLLBACK');const restoredComparisons=comparisons;
  await db.query(`BEGIN;CREATE TEMP TABLE cliente ("IdCliente" int PRIMARY KEY,"RFC" text,"RazonSocial" text,"CodigoPostal" text);
   CREATE TEMP TABLE proveedor ("IdProveedor" int PRIMARY KEY,"RFC" text,"RazonSocial" text,"CodigoPostal" text);
   CREATE TEMP TABLE crm_unidad_cliente(id_cliente int,vin text,esn text,numero_economico text,placas text);
   INSERT INTO cliente SELECT n,'RFC'||n,CASE WHEN n%1000=0 THEN 'Q04TARGET%' ELSE 'Cliente Diesel '||n END,'89000' FROM generate_series(1,20000)n;
   INSERT INTO proveedor SELECT * FROM cliente;
   INSERT INTO crm_unidad_cliente SELECT "IdCliente",'VIN'||"IdCliente",'ESN'||"IdCliente",'ECO'||"IdCliente",'PLACA'||"IdCliente" FROM cliente;
   INSERT INTO crm_unidad_cliente VALUES(1000,'VIN1000','ESN1000','ECO1000','PLACA1000');
   INSERT INTO cliente VALUES(20001,'A',NULL,'B'),(20002,'A','','B'),(20003,NULL,NULL,NULL),(20004,'100%','a_b',E'c\\\\d'),(20005,'RFC','ÁRBOL Ñ İ ß','08900');
   CREATE INDEX ON crm_unidad_cliente(id_cliente);
   CREATE INDEX ON cliente USING gin(public.directory_search_document(ARRAY["IdCliente"::text,"RFC"::text,"RazonSocial"::text,"CodigoPostal"::text]) public.gin_trgm_ops);
   CREATE INDEX ON proveedor USING gin(public.directory_search_document(ARRAY["IdProveedor"::text,"RFC"::text,"RazonSocial"::text,"CodigoPostal"::text]) public.gin_trgm_ops);
   CREATE INDEX ON crm_unidad_cliente USING gin(public.directory_search_document(ARRAY[vin::text,esn::text,numero_economico::text,placas::text]) public.gin_trgm_ops);
   ANALYZE cliente;ANALYZE proveedor;ANALYZE crm_unidad_cliente;`);
  await compare(['','Q04TARGET','Cliente','VIN1000','ESN1000','ECO1000','PLACA1000','A B','A  B','%','_','\\','ÁRBOL','Ñ','İ','ß','RFC1000 Q04TARGET','sin-coincidencias']);
  const rows=[];for(const domain of ['cliente','proveedor'])for(const term of ['Q04TARGET','Cliente','VIN1000','%']){
   const q=query({term});let statements=[];await directoryPage({query:async(sql,params)=>{statements.push({sql,params});if(/^SELECT 1 /.test(sql))return (await db.query(sql,params)).rows;return /SELECT count\(\*\)/i.test(sql)?[{total:0}]:[];}},domain,q);
   const old=legacySql(domain,q);rows.push({domain,scenario:term,before:await timing(db,`SELECT count(*) total ${old.from}`,[term]),after:await timing(db,statements.filter(stmt=>/^SELECT 1 |SELECT count/.test(stmt.sql)))});
  }
  const start=performance.now();await db.query(`UPDATE cliente SET "RazonSocial"='Renombrado' WHERE "IdCliente"=1000;UPDATE proveedor SET "RazonSocial"='Renombrado' WHERE "IdProveedor"=1000;UPDATE crm_unidad_cliente SET vin='VIN-NUEVO' WHERE id_cliente=1000`);const indexedUpdateMs=performance.now()-start;
  await compare(['Renombrado','VIN-NUEVO','VIN1000']);
  await db.query(`INSERT INTO cliente VALUES(32000,'RFCALTA','ALTA-INDEXADA','89000');INSERT INTO proveedor VALUES(32000,'RFCALTA','ALTA-INDEXADA','89000');INSERT INTO crm_unidad_cliente VALUES(32000,'VIN-ALTA','ESN-ALTA','ECOALTA','PLACAALTA')`);
  await compare(['ALTA-INDEXADA','VIN-ALTA','ESN-ALTA']);
  const sizes=(await db.query("SELECT sum(pg_relation_size(indexrelid))::bigint bytes FROM pg_index WHERE indrelid IN ('pg_temp.cliente'::regclass,'pg_temp.proveedor'::regclass,'pg_temp.crm_unidad_cliente'::regclass) AND indexrelid IN (SELECT oid FROM pg_class WHERE relam=(SELECT oid FROM pg_am WHERE amname='gin'))")).rows[0];
  await db.query('ROLLBACK');report={generatedAt:new Date().toISOString(),node:process.versions.node,migration:'081_busqueda_directorios_trigram.sql',restoredComparisons,totalComparisons:comparisons,fixtureClients:20005,fixtureProviders:20000,indexedUpdateMs,ginIndexBytes:Number(sizes.bytes),rows,limitations:['Base restaurada y corpus sintetico; no concurrencia ni SLA.','Costo de actualizar tres registros es una muestra; costo general de GIN medido en Q04.5.2b.']};
 }finally{if(db)await db.end();if(created){assert.match(name,/^sistema_directory_verify_\d+_[a-f0-9]{6}$/);await admin.query(`DROP DATABASE "${name}"`);}await admin.end();}
 fs.writeFileSync(path.join(__dirname,'../../docs/q0452c-directories.json'),JSON.stringify(report,null,2)+'\n');console.table(report.rows.map(r=>({domain:r.domain,scenario:r.scenario,beforeMs:r.before.medianMs,afterMs:r.after.medianMs,indexUsed:!!r.after.nodes['Bitmap Index Scan']})));console.log(`${report.totalComparisons} comparaciones pagina/conteo/CSV aprobadas (${report.restoredComparisons} en respaldo restaurado); migracion check/migrate probada; base aislada eliminada.`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
