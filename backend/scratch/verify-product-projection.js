const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Client}=require('pg');const {databaseConfig}=require('../db-config');const {ProductoService,PRODUCT_SOURCE,PRODUCT_INDEXED_FROM,PRODUCT_LITERAL_FROM}=require('../dist/producto/producto.service');
function nodes(p,out={}){out[p['Node Type']]=(out[p['Node Type']]||0)+1;for(const child of p.Plans||[])nodes(child,out);return out;}
async function outcome(work){try{return {value:await work()}}catch(e){return {error:e.message}}}
async function main(){const c=new Client(databaseConfig());await c.connect();let comparisons=0;const metrics=[];
 const source={query:async(sql,params)=>(await c.query(sql,params)).rows};const current=new ProductoService(source);const legacy=new ProductoService({query:async(sql,params)=>(await c.query(sql.replace(PRODUCT_INDEXED_FROM,PRODUCT_LITERAL_FROM).replace(PRODUCT_SOURCE,"fn_get_productos(NULL, NULL, '')"),params)).rows});
 async function compare(terms){for(const term of terms)for(const [page,limit,sort,order] of [[1,10,'',''],[2,1,'codigo','asc'],[1,25,'categoriaNombre','desc']]){assert.deepEqual(await current.findAll(page,limit,sort,order,term),await legacy.findAll(page,limit,sort,order,term));assert.deepEqual(await outcome(()=>current.exportCsv(sort,order,term)),await outcome(()=>legacy.exportCsv(sort,order,term)));comparisons+=2;}}
 try{
  await c.query("BEGIN READ ONLY;SET LOCAL statement_timeout='30s'");await compare(['','Filtro','Diesel','%','_','\\','OEM-123','ISX','---','sin-coincidencias']);const realComparisons=comparisons;
  const statements=[];await new ProductoService({query:async(sql,params)=>{statements.push({sql,params});return /^SELECT COUNT/i.test(sql.trim())?[{count:0}]:[];}}).findAll(1,10,'','','');
  for(const [index,stmt] of statements.entries())for(const variant of ['legacy','direct']){const samples=[];let tree;for(let n=0;n<5;n++){const plan=(await c.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+(variant==='legacy'?stmt.sql.replace(PRODUCT_INDEXED_FROM,PRODUCT_LITERAL_FROM).replace(PRODUCT_SOURCE,"fn_get_productos(NULL, NULL, '')"):stmt.sql),stmt.params)).rows[0]['QUERY PLAN'][0];samples.push(plan['Execution Time']);tree=nodes(plan.Plan);}samples.sort((a,b)=>a-b);metrics.push({operation:index===0?'conteo':'pagina',variant,medianMs:samples[2],samplesMs:samples,nodes:tree});}
  await c.query('ROLLBACK');await c.query(`BEGIN;
   CREATE TEMP TABLE producto("IdProducto" int,"Codigo" varchar,"IdUnidad" int,"IdObjetoImpuesto" int,"Descripcion" varchar,"PrecioUnitario" numeric,"IdCategoria" int,"Ubicacion" varchar,"IdClaveProdOServ" int,"IdClaveUnidad" int,"Marca" varchar,"ObjetoImpuesto" varchar,"TasaIVA" numeric,"AplicaRetencionISR" boolean,"AplicaRetencionIVA" boolean,"Existencia" numeric,imagenes jsonb);
   CREATE TEMP TABLE categoria("IdCategoria" int,"Descripcion" varchar);
   CREATE TEMP TABLE claveproductooservicio("IdClaveProdOServ" int,"Clave" varchar,"Descripcion" text);
   CREATE TEMP TABLE claveunidad("IdClaveUnidad" int,"Clave" varchar,"Descripcion" text);
   CREATE TEMP TABLE producto_equivalente("IdProducto" int,"IdProductoEquivalente" int);
   CREATE TEMP TABLE reserva_inventario(id_producto int,cantidad numeric,cantidad_liberada numeric,estado text);
   CREATE TEMP TABLE producto_numero_parte(id_producto int,numero_normalizado text);
   CREATE TEMP TABLE producto_aplicacion(id_producto int,fabricante_equipo varchar,modelo varchar,motor varchar,restricciones varchar);
   INSERT INTO categoria VALUES(1,'Filtros');INSERT INTO claveproductooservicio VALUES(1,'40161500','Parte diesel');INSERT INTO claveunidad VALUES(1,'H87','Pieza');
   INSERT INTO producto VALUES(1,'100%',1,1,'Filtro A',850,1,'A',1,1,'Marca A','02',16,false,false,10,'["/uploads/fixture-a.png","/uploads/fixture-b.png"]'),(2,'OTRO',1,1,'Filtro B',700,999,'B',NULL,NULL,'Marca B','02',16,false,false,0,'[]'),(3,'TERCERO',1,1,'Otro',100,NULL,NULL,NULL,NULL,NULL,'02',0,false,false,5,NULL);
   INSERT INTO producto_equivalente VALUES(1,2),(1,3);
   INSERT INTO reserva_inventario VALUES(1,3,0,'Activa'),(1,10,10,'Surtida'),(1,99,0,'Cancelada'),(2,20,0,'Activa');
   INSERT INTO producto_numero_parte VALUES(2,'oem123'),(2,'oem1234');INSERT INTO producto_aplicacion VALUES(2,'Camion','Modelo','ISX',''),(2,'Camion','Modelo','ISX','');
  `);
  await compare(['','Filtro','Filtros','%','_','\\','OEM-123','ISX','---','Otro']);
  const all=await current.findAll(1,10,'codigo','asc','');const rich=all.data.find(p=>p.IdProducto===1);assert.deepEqual(rich.imagenes,['/uploads/fixture-a.png','/uploads/fixture-b.png']);assert.deepEqual(rich.EquivalentesJSON,[2,3]);assert.equal(rich.ClaveProdServ,'40161500');assert.equal(rich.ClaveUnidadSat,'H87');assert.equal(Number(rich.Disponible),7);assert.equal((await current.findAll(1,10,'','','OEM-123')).total,1);
  const report={generatedAt:new Date().toISOString(),node:process.versions.node,realComparisons,totalComparisons:comparisons,metrics,limitations:['Comparacion real READ ONLY y fixtures temporales con ROLLBACK.','Cinco muestras en base actual; sin concurrencia ni SLA.','Valida datos de imagen/SAT/equivalentes; no sustituye inspeccion visual de archivos.','Sin indices nuevos de OEM/aplicaciones en este bloque.']};
  await c.query('ROLLBACK');fs.writeFileSync(path.join(__dirname,'../../docs/'+(process.env.PRODUCT_SEARCH_REPORT === 'q0452d2-products.json' ? 'q0452d2-products.json' : 'q0452d1-products.json')),JSON.stringify(report,null,2)+'\n');console.table(metrics.map(m=>({operation:m.operation,variant:m.variant,medianMs:m.medianMs,functionScan:m.nodes['Function Scan']||0})));console.log(`${comparisons} comparaciones de pagina/CSV (${realComparisons} reales) aprobadas; imagenes/SAT/equivalentes/reservas/OEM/aplicaciones conservados; fixtures revertidos.`);
 }finally{await c.query('ROLLBACK');await c.end();}}
main().catch(e=>{console.error(e.message);process.exitCode=1});
