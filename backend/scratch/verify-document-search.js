const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { Client } = require('pg');
const { databaseConfig } = require('../db-config');
const { documentSearch } = require('../dist/common/document-search');
const invoice = require('../dist/venta/factura-query');
const quote = require('../dist/cotizacion/cotizacion-query');
const domains = [
  { name:'factura', mod:invoice, Dto:invoice.FacturaQueryDto, page:invoice.facturaPage, csv:invoice.facturaCsv },
  { name:'cotizacion', mod:quote, Dto:quote.CotizacionQueryDto, page:quote.cotizacionPage, csv:quote.cotizacionCsv },
];
async function main() {
  const db = new Client(databaseConfig()); await db.connect();
  let comparisons=0,plans=0; const metrics=[];
  const source = { query:async(sql,params)=>(await db.query(sql,params)).rows };
  const legacy = domain => ({ query:async(sql,params)=>sql.startsWith('SELECT 1 ')?Array.from({length:257},()=>({})):source.query(sql.replace(documentSearch(params[0],domain.mod.DOCUMENT_LEGACY,domain.mod.DOCUMENT_INDEXED),domain.mod.DOCUMENT_LEGACY),params) });
  const cases=['','Q04TARGET','Cliente','1000','C-1000','NC-1000','%','_','\\',"%_'\\",'ÁRBOL','Ñ','İ','ß','A B','A  B','RFC1000','sin-coincidencias','BOUND256','BOUND257','20002 A','20004 A  B'];
  async function compare(terms) {
    for(const domain of domains) for(const term of terms) for(const filter of [{},{page:2,limit:1,sortBy:'total',sortOrder:'asc'},{estado:'Pendiente',desde:'2026-10-01',hasta:'2026-10-01'}]) {
      const query=Object.assign(new domain.Dto(),filter,{term});
      assert.deepEqual(await domain.page(source,query),await domain.page(legacy(domain),query),`${domain.name} page ${term}`); comparisons++;
      // Tope CSV es parte del contrato, no un truncamiento válido.
      const result=await Promise.allSettled([domain.csv(source,query),domain.csv(legacy(domain),query)]);
      assert.equal(result[0].status,result[1].status);
      if(result[0].status==='fulfilled') assert.equal(result[0].value,result[1].value);
      else { assert.match(result[0].reason.message,/5000 registros/); assert.equal(result[0].reason.message,result[1].reason.message); }
      comparisons++;
    }
  }
  async function measure(domain,term,executor) {
    const captured=[];
    await domain.page({query:async(sql,params)=>{
      if(sql.startsWith('SELECT 1 ')) {
        if(executor==='legacy')return Array.from({length:257},()=>({}));
        captured.push({sql,params});return source.query(sql,params);
      }
      if(sql.startsWith('SELECT count'))captured.push({sql,params});
      return sql.startsWith('SELECT count')?[{count:0,total:0}]:[];
    }},Object.assign(new domain.Dto(),{term}));
    const samples=[];let indexUsed=false;
    for(let n=0;n<5;n++){let total=0;for(const statement of captured){const plan=(await db.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+statement.sql,statement.params)).rows[0]['QUERY PLAN'][0];total+=plan['Execution Time'];plans++;indexUsed ||= JSON.stringify(plan.Plan).includes('Bitmap Index Scan');}samples.push(total);}
    samples.sort((a,b)=>a-b);return {medianMs:samples[2],samplesMs:samples,indexUsed};
  }
  try {
    await db.query("BEGIN READ ONLY; SET LOCAL statement_timeout='30s'");
    await compare(['','Q04TARGET','%']);
    const existingComparisons=comparisons;
    await db.query('ROLLBACK; BEGIN');
    await db.query(`CREATE TEMP TABLE factura(id_factura int PRIMARY KEY,folio int,serie varchar,nombre_receptor varchar,rfc_receptor varchar,fecha_emision timestamptz,total numeric,estatus text,tipo_comprobante varchar);
      CREATE TEMP TABLE cotizacion(id_cotizacion int PRIMARY KEY,folio int,nombre_receptor varchar,rfc_receptor varchar,fecha_emision timestamptz,total numeric,estatus text);
      CREATE TEMP TABLE pedido_venta(id_pedido int,id_cotizacion int);
      CREATE TEMP TABLE fiscal_documento(id_factura int,estado text);
      INSERT INTO factura SELECT n,n,CASE WHEN n%2=0 THEN 'NC' ELSE 'A' END,CASE WHEN n BETWEEN 1 AND 256 THEN 'BOUND256' WHEN n BETWEEN 300 AND 556 THEN 'BOUND257' WHEN n%1000=0 THEN 'Q04TARGET%' ELSE 'Cliente Diesel '||n END,'RFC'||n,'2026-10-01 23:59:59.999-06',n,'Pendiente',CASE WHEN n%2=0 THEN 'E' ELSE 'I' END FROM generate_series(1,20000)n;
      INSERT INTO cotizacion SELECT id_factura,folio,nombre_receptor,rfc_receptor,fecha_emision,total,estatus FROM factura;
      INSERT INTO factura VALUES(20001,NULL,NULL,NULL,NULL,'2026-10-02 00:00:00-06',0,'Cancelada','I'),(20002,20002,'','A','','2026-10-01 00:00:00-06',0,'Pendiente','E'),(20003,20003,'A','100% a_b c\\d ÁRBOL Ñ İ ß',NULL,'2026-09-30 23:59:59.999-06',0,'Pendiente','I'),(20004,20004,'','A  B',NULL,'2026-10-01 00:00:00-06',0,'Pendiente','I');
      INSERT INTO cotizacion SELECT id_factura,folio,nombre_receptor,rfc_receptor,fecha_emision,total,estatus FROM factura WHERE id_factura>20000;
      INSERT INTO pedido_venta VALUES(1,1000),(2,1000); INSERT INTO fiscal_documento VALUES(1000,'Timbrado'); SET LOCAL TIME ZONE 'UTC';`);
    // Índices con la expresión exacta de la migración y del servicio.
    const indexStart=performance.now();
    for(const d of domains) await db.query(`CREATE INDEX fixture_${d.name}_trgm ON ${d.name} USING gin(${d.mod.DOCUMENT_INDEXED.replaceAll('f.','')} public.gin_trgm_ops); ANALYZE ${d.name}`);
    const indexBuildMs=performance.now()-indexStart;
    await compare(cases);
    for(const d of domains) {
      if(d.name==='factura') for(const tipo of ['I','E']) {
        const q=Object.assign(new d.Dto(),{term:'Q04TARGET',tipo});
        assert.deepEqual(await d.page(source,q),await d.page(legacy(d),q));comparisons++;
        assert.equal(await d.csv(source,q),await d.csv(legacy(d),q));comparisons++;
      }
      for(const term of ['Q04TARGET','Cliente','RFC1000','%']) metrics.push({domain:d.name,term,before:await measure(d,term,'legacy'),after:await measure(d,term,'indexed')});
    }
    const writeStart=performance.now();
    await db.query("UPDATE factura SET nombre_receptor='RENOMBRADO',serie='XYZ' WHERE id_factura=1000; UPDATE cotizacion SET nombre_receptor='RENOMBRADO',folio=77777 WHERE id_cotizacion=1000; INSERT INTO factura VALUES(20005,88888,'XYZ','NUEVO-CLIENTE','RFC-NUEVO','2026-10-01 12:00:00-06',10,'Pendiente','I'); INSERT INTO cotizacion SELECT id_factura,folio,nombre_receptor,rfc_receptor,fecha_emision,total,estatus FROM factura WHERE id_factura=20005");
    const indexedWriteMs=performance.now()-writeStart;
    await compare(['RENOMBRADO','XYZ-1000','C-77777','NUEVO-CLIENTE']);
    const indexBytes=Number((await db.query("SELECT sum(pg_relation_size(indexrelid))::bigint bytes FROM pg_index WHERE indexrelid IN ('pg_temp.fixture_factura_trgm'::regclass,'pg_temp.fixture_cotizacion_trgm'::regclass)")).rows[0].bytes);
    await db.query('ROLLBACK');
    fs.writeFileSync(path.join(__dirname,'../../docs/q0452e1-documents.json'),JSON.stringify({generatedAt:new Date().toISOString(),node:process.versions.node,existingComparisons,comparisons,fixtureRowsPerDomain:20004,plans,indexBuildMs,indexedWriteMs,indexBytes,metrics,limitations:['Fixtures sintéticos; sin carga concurrente ni SLA.','Tiempos posteriores incluyen sondeo; no garantizan mejora universal.','Costos de escritura son muestra única, sin comparación estadística previa.','Compras requiere conservar concatenación con proveedor; pendiente.']},null,2)+'\n');
    console.table(metrics.map(x=>({domain:x.domain,term:x.term,before:x.before.medianMs,after:x.after.medianMs,index:x.after.indexUsed})));
    console.log(`${comparisons} comparaciones exactas, ${existingComparisons} sobre datos existentes; ${plans} planes; fixtures revertidos.`);
  } finally {await db.query('ROLLBACK');await db.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
