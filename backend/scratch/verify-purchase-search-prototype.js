const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { Client } = require('pg');
const { databaseConfig } = require('../db-config');
const literal = "strpos(lower(concat_ws(' ',b.id::text,b.folio,p.name,p.rfc)),lower($1))>0";
const joined = 'FROM q04_purchase b JOIN q04_supplier p ON p.id=b.supplier';
const purchaseText = 'public.directory_search_document(ARRAY[id::text,folio])';
const supplierText = 'public.directory_search_document(ARRAY[id::text,rfc,name,cp])';
const candidates = `SELECT id FROM q04_purchase WHERE ${purchaseText} LIKE lower($2) ESCAPE chr(92)
 UNION SELECT b.id FROM q04_supplier p JOIN q04_purchase b ON b.supplier=p.id
 WHERE public.directory_search_document(ARRAY[p.id::text,p.rfc,p.name,p.cp]) LIKE lower($2) ESCAPE chr(92)`;
const baseline = `SELECT b.id ${joined} WHERE ${literal}`;
function sql(term) {
  // Un término sin espacios no puede cruzar el separador concat_ws.
  // El documento de proveedor es un superconjunto: filtro final elimina extras.
  return /[\p{L}\p{N}]{3}/u.test(term) && !/\s/u.test(term)
    ? `${baseline} AND b.id IN (${candidates})` : baseline;
}
function params(term) { return [term,'%'+term.replace(/[\\%_]/g,x=>'\\'+x)+'%']; }
async function main() {
  const db=new Client(databaseConfig()); await db.connect();let report;
  let comparisons=0,plans=0;
  async function measure(query,values) {
    const samples=[];let indexUsed=false;
    for(let n=0;n<5;n++) {
      const p=(await db.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query,values)).rows[0]['QUERY PLAN'][0];
      samples.push(p['Execution Time']);indexUsed ||= JSON.stringify(p.Plan).includes('Bitmap Index Scan');plans++;
    }
    samples.sort((a,b)=>a-b);return {medianMs:samples[2],samplesMs:samples,indexUsed};
  }
  async function compare(terms) {
    for(const raw of terms) {
      const term=raw.trim(),candidate=sql(term),values=params(term);
      // Minúsculas y escape se calculan en PostgreSQL, igual que en operación.
      values[1]=(await db.query("SELECT '%'||replace(replace(replace(lower($1),chr(92),chr(92)||chr(92)),'%',chr(92)||'%'),'_',chr(92)||'_')||'%' pattern",[term])).rows[0].pattern;
      for(const suffix of [' ORDER BY b.id',' ORDER BY b.id DESC LIMIT 3 OFFSET 1']) {
        assert.deepEqual((await db.query(candidate+suffix,candidate===baseline?[term]:values)).rows,(await db.query(baseline+suffix,[term])).rows,term);comparisons++;
      }
    }
  }
  try {
    await db.query("BEGIN; SET LOCAL statement_timeout='30s'");
    await db.query(`CREATE TEMP TABLE q04_supplier(id int PRIMARY KEY,name text,rfc text,cp text);
      CREATE TEMP TABLE q04_purchase(id int PRIMARY KEY,folio text,supplier int);
      INSERT INTO q04_supplier SELECT n,CASE WHEN n%1000=0 THEN 'Q04TARGET%' ELSE 'Proveedor Diesel '||n END,'RFC'||n,'89000' FROM generate_series(1,20000)n;
      INSERT INTO q04_purchase SELECT n,'F'||n,n FROM generate_series(1,20000)n;
      INSERT INTO q04_supplier VALUES(20001,NULL,NULL,NULL),(20002,'A','',''),(20003,'100% a_b c\\d ÁRBOL Ñ İ ß','RFC','CP'),(20004,'Proveedor Compartido','COMPARTIDO','');
      INSERT INTO q04_purchase VALUES(20001,NULL,20001),(20002,'',20002),(20003,'F-EXTRA',20003),(20004,'F-COMPARTIDO',20004),(20005,'F-OTRO',20004),(20006,'HUERFANO',NULL);`);
    const terms=['Q04TARGET','Proveedor','RFC1000','F1000','89000','1000 F1000','F1000 Q04TARGET','A','A  ','%','_','\\','ÁRBOL','Ñ','İ','ß','COMPARTIDO','','sin-coincidencias'];
    await compare(terms);
    const start=performance.now();
    await db.query(`CREATE INDEX q04_purchase_text ON q04_purchase USING gin(${purchaseText} public.gin_trgm_ops);
      CREATE INDEX q04_supplier_text ON q04_supplier USING gin(${supplierText} public.gin_trgm_ops);
      CREATE INDEX q04_purchase_supplier ON q04_purchase(supplier);ANALYZE q04_purchase;ANALYZE q04_supplier;`);
    const indexBuildMs=performance.now()-start;await compare(terms);
    const metrics=[];
    for(const term of ['Q04TARGET','Proveedor','RFC1000','F1000','F1000 Q04TARGET']) {
      const candidate=sql(term),values=params(term);
      metrics.push({term,before:await measure(baseline,[term]),after:await measure(candidate,candidate===baseline?[term]:values)});
    }
    const write=performance.now();
    await db.query("UPDATE q04_supplier SET name='RENOMBRADO',rfc='RFC-NUEVO' WHERE id=1000;UPDATE q04_purchase SET folio='F-NUEVO' WHERE id=1000;INSERT INTO q04_purchase VALUES(30000,'F-ALTA',1000)");
    const indexedWriteMs=performance.now()-write;
    await compare(['RENOMBRADO','RFC-NUEVO','F-NUEVO RENOMBRADO','F-ALTA','Q04TARGET','COMPARTIDO']);
    const indexBytes=Number((await db.query("SELECT sum(pg_relation_size(indexrelid))::bigint bytes FROM pg_index WHERE indexrelid IN('pg_temp.q04_purchase_text'::regclass,'pg_temp.q04_supplier_text'::regclass,'pg_temp.q04_purchase_supplier'::regclass)")).rows[0].bytes);
    report={generatedAt:new Date().toISOString(),node:process.versions.node,comparisons,plans,indexBuildMs,indexedWriteMs,indexBytes,metrics,limitations:['Prototipo temporal, sin integración en endpoints ni migración.','Términos con espacios y cortos conservan consulta anterior.','Proveedor indexado produce candidatos extra que elimina filtro final.','Sin concurrencia, validación CSV de servicios ni SLA; costos de escritura son una muestra.']};
    await db.query('ROLLBACK');
  } finally {await db.query('ROLLBACK');await db.end();}
  fs.writeFileSync(path.join(__dirname,'../../docs/q0452e2a-purchases.json'),JSON.stringify(report,null,2)+'\n');
  console.table(report.metrics.map(x=>({term:x.term,before:x.before.medianMs,after:x.after.medianMs,index:x.after.indexUsed})));
  console.log(`${comparisons} comparaciones exactas y ${plans} planes; tablas temporales revertidas.`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
