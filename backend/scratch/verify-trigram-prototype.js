const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { Client } = require('pg');
const { databaseConfig } = require('../db-config');
const escaped = term => '%' + term.replace(/[\\%_]/g, value => '\\' + value) + '%';
const baseline = "SELECT id FROM search_fixture WHERE strpos(lower(concat_ws(' ',a,b,c,d)),lower($1))>0 ORDER BY id";
const candidate = "SELECT id FROM search_fixture WHERE document LIKE lower($1) ESCAPE chr(92) ORDER BY id";
function nodes(plan, result = {}) {
  result[plan['Node Type']] = (result[plan['Node Type']] || 0) + 1;
  for (const child of plan.Plans || []) nodes(child, result);
  return result;
}
async function measure(db, sql, value) {
  const samples = [];
  for (let i=0;i<5;i++) {
    const response = await db.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + sql, [value]);
    const plan = response.rows[0]['QUERY PLAN'][0];
    samples.push({ ms: plan['Execution Time'], rows: plan.Plan['Actual Rows'], nodes: nodes(plan.Plan) });
  }
  samples.sort((a,b)=>a.ms-b.ms);
  return { medianMs: samples[2].ms, samplesMs: samples.map(s=>s.ms), rows: samples[2].rows, nodes: samples[2].nodes };
}
async function main() {
  const base = databaseConfig(); const admin = new Client(base);
  const name = `sistema_search_verify_${Date.now()}_${randomBytes(3).toString('hex')}`;
  assert.match(name, /^sistema_search_verify_\d+_[a-f0-9]{6}$/);
  let created=false; let db; let report;
  await admin.connect();
  try {
    const operational = (await admin.query('SELECT current_database() name')).rows[0].name;
    assert.notEqual(name, operational);
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`); created=true;
    const options = { ...base, database: name };
    if (base.connectionString) { const url=new URL(base.connectionString); url.pathname='/'+name; options.connectionString=url.toString(); }
    db = new Client(options); await db.connect();
    assert.equal((await db.query('SELECT current_database() name')).rows[0].name, name);
    await db.query("SET statement_timeout='30s'; CREATE EXTENSION pg_trgm");
    await db.query(`CREATE FUNCTION search_document(parts text[]) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $body$
      SELECT lower(array_to_string(array_remove(parts,NULL),' ')); $body$;
      CREATE TABLE search_fixture (id int PRIMARY KEY,a text,b text,c text,d text,
        document text GENERATED ALWAYS AS (search_document(ARRAY[a,b,c,d])) STORED);`);
    await db.query(`INSERT INTO search_fixture(id,a,b,c,d) SELECT n,'RFC'||n,
      CASE WHEN n%1000=0 THEN 'Q04TARGET%' ELSE 'Cliente Diesel '||n END,
      CASE WHEN n%7=0 THEN NULL ELSE 'VIN'||n END,'ESN'||n FROM generate_series(1,20000) n`);
    await db.query("INSERT INTO search_fixture(id,a,b,c,d) VALUES (20001,'A',NULL,'B',''),(20002,'A','','B',NULL),(20003,NULL,NULL,NULL,NULL),(20004,'100%','a_b',E'c\\\\d','Árbol Ñ I İ ß'),(20005,'RFC','CLIENTE','VIN','ESN')");
    const insertStart=performance.now();
    await db.query("INSERT INTO search_fixture(id,a,b,c,d) SELECT n,'RFC'||n,'Carga','VIN'||n,'ESN'||n FROM generate_series(30001,31000) n");
    const insertWithoutIndexMs=performance.now()-insertStart;
    await db.query('DELETE FROM search_fixture WHERE id>=30001');
    const updateStart=performance.now();await db.query("UPDATE search_fixture SET b=b||' actualizado' WHERE id<=1000");
    const updateWithoutIndexMs=performance.now()-updateStart;
    await db.query("UPDATE search_fixture SET b=replace(b,' actualizado','') WHERE id<=1000");
    await db.query('ANALYZE search_fixture');
    const cases=['Q04TARGET','Cliente','VIN1000','ESN1000','RFC20005 CLIENTE','CLIENTE VIN','A B','A  B','%','_','\\','ÁRBOL','ñ','İ','ß','I','a','',"%_'\\"];
    const before=[];
    for (const term of cases) {
      assert.deepEqual((await db.query(candidate,[escaped(term)])).rows,(await db.query(baseline,[term])).rows,`Equivalencia sin indice: ${term}`);
      before.push(await measure(db,baseline,term));
    }
    const indexStart=performance.now();
    await db.query('CREATE INDEX search_fixture_document_trgm ON search_fixture USING gin(document gin_trgm_ops)');
    const indexBuildMs=performance.now()-indexStart;
    await db.query('ANALYZE search_fixture');
    const rows=[];
    for (const [i,term] of cases.entries()) {
      assert.deepEqual((await db.query(candidate,[escaped(term)])).rows,(await db.query(baseline,[term])).rows,`Equivalencia con indice: ${term}`);
      const after=await measure(db,candidate,escaped(term));
      rows.push({ scenario: term || '(vacio)', before: before[i], after });
    }
    const indexedInsertStart=performance.now();
    await db.query("INSERT INTO search_fixture(id,a,b,c,d) SELECT n,'RFC'||n,'Carga','VIN'||n,'ESN'||n FROM generate_series(30001,31000) n");
    const insertWithIndexMs=performance.now()-indexedInsertStart;
    const indexedUpdateStart=performance.now();await db.query("UPDATE search_fixture SET b=b||' actualizado' WHERE id<=1000");
    const updateWithIndexMs=performance.now()-indexedUpdateStart;
    // Columna generada debe reflejar altas/cambios y seguir siendo equivalente.
    assert.deepEqual((await db.query(candidate,[escaped('actualizado')])).rows,(await db.query(baseline,['actualizado'])).rows);
    const sizes=(await db.query("SELECT pg_relation_size('search_fixture_document_trgm')::int index_bytes,pg_total_relation_size('search_fixture')::int total_bytes")).rows[0];
    const cleanupStart=performance.now(); await db.query("SELECT gin_clean_pending_list('search_fixture_document_trgm'::regclass)");
    const pendingCleanupMs=performance.now()-cleanupStart;
    report={ generatedAt:new Date().toISOString(),node:process.versions.node,fixtureRows:20005,repetitions:5,equivalenceCases:cases.length*2+1,
      isolation:'Base efimera nueva con datos sinteticos; extension e indice solo en esa base; eliminada al terminar.',
      limitations:['Sin concurrencia ni SLA.','Tiempos de escritura son una muestra de 1000 filas; incluyen columna generada.','Documento sintetico valida concatenacion/literalidad; aun no integra los seis dominios ni relaciones/OEM.'],
      writeCosts:{insertWithoutIndexMs,insertWithIndexMs,updateWithoutIndexMs,updateWithIndexMs,indexBuildMs,pendingCleanupMs,...sizes},rows };

  } finally {
    if (db) await db.end();
    if (created) { assert.match(name,/^sistema_search_verify_\d+_[a-f0-9]{6}$/); await admin.query(`DROP DATABASE "${name}"`); }
    await admin.end();
  }
    fs.writeFileSync(path.join(__dirname,'../../docs/q0452b-trigram.json'),JSON.stringify(report,null,2)+'\n');
    console.table(report.rows.map(row=>({scenario:row.scenario,rows:row.after.rows,beforeMs:row.before.medianMs,afterMs:row.after.medianMs,indexUsed:!!row.after.nodes['Bitmap Index Scan']})));
    console.log(`${report.equivalenceCases} comparaciones de IDs exactos aprobadas; ${report.rows.length*10} planes medidos.`);
    console.log('Costos de escritura/indice registrados; base aislada eliminada.');
}
main().catch(error=>{ console.error(error.message); process.exitCode=1; });
