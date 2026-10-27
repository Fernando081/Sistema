require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomBytes,randomUUID,createHmac } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { WebLeadBridgeController } = require('./dist/crm/web-lead-bridge.controller');
const { createLeadBridge } = require('../public-web/lead-bridge.mjs');
const { validateLead,leadFingerprint } = require('../public-web/lead-contract.mjs');
const { readFileSync } = require('node:fs');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { once } = require('node:events');
const { join } = require('node:path');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { databaseConfig } = require('./db-config');
const { CrmSolicitudesWebService } = require('./dist/crm/crm-solicitudes-web.service');
const { bridgeEnvironmentKeys } = require('./dist/crm/web-lead-bridge.config');
const { verifyBridgeRotation } = require('./verify-web-bridge-rotation');
const { verifyIntakeProfile } = require('./verify-web-intake-profile');

async function verifyNativeFlow(bridge, key, db, service) {
  const { build, pagesForCatalog } = await import('../public-web/build.mjs');
  const { createPreviewServer } = await import('../public-web/server.mjs');
  const { leadFromForm } = await import('../public-web/lead-form.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'rtt-web-inbox-flow-'));
  const product = (slug, code) => ({
    slug, code, status: 'published', approved: true, brand: 'Marca fixture',
    category: 'Familia fixture', title: 'Pieza ' + code,
    description: 'Contenido fixture aislado', applications: [], references: [], specifications: [],
  });
  const products = [product('pieza-a', 'OEM-A'), product('pieza-b', 'OEM-B')];
  const catalog = { schemaVersion: 1, products };
  const fields = new URLSearchParams({
    requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    privacyVersion: 'fixture-v1', privacyAccepted: 'yes', name: 'Contacto fixture',
    channel: 'email', value: 'fixture@example.com',
    slug: 'pieza-a', quantity: '2', slug2: 'pieza-b', quantity2: '4',
    code3: 'REFERENCIA-FIXTURE', brand3: '', application3: 'Aplicación fixture', quantity3: '3',
  });
  const expected = validateLead(leadFromForm(fields.toString()), catalog, 'fixture-v1');
  let server, releaseReceipt;
  let committed = false;
  const receipt = new Promise(resolve => { releaseReceipt = resolve; });
  const intake = {
    privacyApproved: true, privacyVersion: 'fixture-v1',
    privacyText: 'Aviso fixture para prueba aislada; no es un aviso operativo.',
    origin: 'http://127.0.0.1', key, storageTimeoutMs: 1000,
    receive: async (lead, fingerprint) => {
      await bridge(lead, fingerprint);
      committed = true;
      // The database has committed but the browser receives no timely receipt.
      await receipt;
    },
  };
  try {
    await build(directory, pagesForCatalog(products), products);
    server = await createPreviewServer(directory, { intake });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    intake.origin = `http://127.0.0.1:${server.address().port}`;
    const post = () => fetch(intake.origin + '/solicitudes', {
      method: 'POST', headers: { Origin: intake.origin, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: fields.toString(), signal: AbortSignal.timeout(10000),
    });
    const form = await fetch(intake.origin + '/solicitar?producto=pieza-a&cantidad=2&piezas=OEM-B%20%7C%204');
    assert.equal(form.status, 200);
    const formHtml = await form.text();
    assert.ok(formHtml.includes('name="slug" value="pieza-a"'));
    assert.ok(formHtml.includes('name="slug2" value="pieza-b"'));
    const uncertain = await post();
    assert.equal(uncertain.status, 503);
    const uncertainHtml = await uncertain.text();
    assert.ok(committed, 'Commit confirmado antes del vencimiento del recibo');
    assert.ok(uncertainHtml.includes('El envío pudo haber quedado registrado'));
    assert.ok(!uncertainHtml.includes('Solicitud recibida'));
    assert.ok(uncertainHtml.includes(fields.get('requestId')));
    assert.ok(uncertainHtml.includes('name="slug2" value="pieza-b"'));
    assert.ok(uncertainHtml.includes('value="REFERENCIA-FIXTURE"'));
    assert.ok(uncertainHtml.includes('fixture@example.com'));
    const stored = () => db.query('SELECT payload,fingerprint FROM crm_solicitud_web WHERE request_id=$1', [expected.requestId]);
    let rows = await stored();
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].payload, expected);
    const receiptStatus = await service.receiptStatus(expected.requestId);
    assert.equal(receiptStatus.contenido, 'Vigente', 'Reconciliación ve commit aunque no hubo recibo');
    assert.equal(receiptStatus.idOportunidad, null);
    assert.deepEqual(Object.keys(receiptStatus).sort(),
      ['requestId', 'estado', 'version', 'createdAt', 'expiresAt', 'idOportunidad', 'contenido'].sort());
    assert.equal(rows[0].fingerprint, leadFingerprint(leadFromForm(fields.toString()), catalog, 'fixture-v1', key));
    releaseReceipt(); // Late success cannot turn the original 503 into a receipt.
    intake.receive = bridge;
    const retries = await Promise.all([post(), post()]);
    for (const response of retries) {
      assert.equal(response.status, 202);
      const html = await response.text();
      assert.ok(html.includes('Solicitud recibida'));
      assert.ok(!html.includes('fixture@example.com'));
    }
    assert.equal((await stored()).length, 1, 'Reintentos HTTP nativos no duplican');
    fields.set('quantity2', '5');
    const conflict = await post();
    assert.equal(conflict.status, 503);
    assert.ok(!(await conflict.text()).includes('Solicitud recibida'));
    rows = await stored();
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].payload, expected, 'Conflicto no cambia piezas almacenadas');
    const conversions = await Promise.all([
      service.convert(expected.requestId, 1, 1, 2), service.convert(expected.requestId, 1, 1, 2),
    ]);
    assert.deepEqual(conversions[0], conversions[1]);
    assert.equal((await db.query('SELECT * FROM crm_oportunidad_consulta_web WHERE request_id=$1', [expected.requestId])).length, 1);
    assert.deepEqual((await service.snapshot(conversions[0].idOportunidad, 2, false)).piezas, expected.items);
    assert.equal((await service.receiptStatus(expected.requestId)).idOportunidad, conversions[0].idOportunidad);
    console.log('Formulario nativo → puente firmado → PostgreSQL: commit sin recibo, reintentos sin duplicar, conflicto y conversión aprobados en esquema aislado.');
  } finally {
    releaseReceipt();
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}

async function verifyResolutionFlow(service, db, lead) {
  const id = randomUUID(), operation = randomUUID();
  await service.receive({ ...lead, requestId: id }, 'a'.repeat(64));
  const original = (await db.query('SELECT payload,fingerprint,expires_at,estado,id_oportunidad FROM crm_solicitud_web WHERE request_id=$1', [id]))[0];
  const results = await Promise.all([
    service.resolve(id, operation, 'Clave', 1, 1), service.resolve(id.toUpperCase(), operation.toUpperCase(), 'Clave', 1, 1),
  ]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].version, 2);
  assert.equal((await service.resolutions(id)).length, 1);
  assert.deepEqual((await db.query('SELECT payload,fingerprint,expires_at,estado,id_oportunidad FROM crm_solicitud_web WHERE request_id=$1', [id]))[0], original);
  await assert.rejects(service.resolve(id, operation, 'Contenido', 1, 1), /otros datos/);
  await assert.rejects(service.resolve(id, operation, 'Clave', 1, 2), /otros datos/);
  await assert.rejects(service.resolve(randomUUID(), operation, 'Clave', 1, 1), /otros datos/);
  await assert.rejects(service.resolve(id, randomUUID(), 'Catalogo', 1, 1), /Actualiza/);
  await assert.rejects(service.receive({ ...lead, requestId: id }, 'b'.repeat(64)), /ya utilizado/);
  const rollbackKey = randomUUID();
  await assert.rejects(service.resolve(id, rollbackKey, 'Contenido', 2, 9999), error => error.driverError?.code === '23503');
  assert.equal((await service.receiptStatus(id)).version, 2);
  assert.equal((await db.query('SELECT 1 FROM crm_solicitud_web_resolucion WHERE operation_id=$1', [rollbackKey])).length, 0);
  const race = await Promise.allSettled([service.resolve(id, randomUUID(), 'Contenido', 2, 1), service.resolve(id, randomUUID(), 'Catalogo', 2, 1)]);
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await service.receiptStatus(id)).version, 3);
  await db.query("UPDATE crm_solicitud_web SET expires_at=clock_timestamp()-interval '1 second' WHERE request_id=$1", [id]);
  assert.equal((await service.resolve(id, randomUUID(), 'Confirmacion', 3, 1)).contenido, 'Vencido');
  await service.purgeExpired();
  assert.equal((await service.resolve(id, randomUUID(), 'Clave', 5, 1)).contenido, 'Purgado');
  assert.deepEqual(await service.resolve(id, operation, 'Clave', 1, 1), results[0], 'Reintento devuelve decisión original después de purga');
  assert.equal((await db.query('SELECT payload FROM crm_solicitud_web WHERE request_id=$1', [id]))[0].payload, null);
  await assert.rejects(db.query('UPDATE crm_solicitud_web_resolucion SET motivo=$2 WHERE operation_id=$1', [operation, 'Contenido']), error => error.driverError?.code === '23514');
  await assert.rejects(db.query('DELETE FROM crm_solicitud_web_resolucion WHERE operation_id=$1', [operation]), error => error.driverError?.code === '23514');
  for (let version = 6; version < 28; version++) await service.resolve(id, randomUUID(), 'Confirmacion', version, 1);
  const history = await service.resolutions(id);
  assert.equal(history.length, 20); assert.equal(history[0].version, 28);
  assert.ok(history.every(row => !Object.hasOwn(row, 'payload') && !Object.hasOwn(row, 'fingerprint')));
  await assert.rejects(service.resolutions(randomUUID()), /no encontrada/);
  console.log('Resolución conservadora: idempotencia, carreras, rollback, retención, historial20 y bloqueo de edición/borrado aprobados.');
}

async function main() {
  const schema = 'verify_web_inbox_' + randomBytes(8).toString('hex');
  const config = databaseConfig();
  const admin = new Client(config);
  let db;
  let created = false;
  let app;
  const savedBridgeEnv=Object.fromEntries(bridgeEnvironmentKeys.map(key=>[key,process.env[key]]));
  for (const field of bridgeEnvironmentKeys) delete process.env[field];
  await admin.connect();
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    await admin.query(`SET search_path TO "${schema}"`);
    await admin.query('CREATE TABLE auth_user(id_user integer PRIMARY KEY,is_active boolean DEFAULT true)');
    await admin.query('INSERT INTO auth_user(id_user) VALUES(1)');
    await admin.query('INSERT INTO auth_user(id_user,is_active) VALUES(2,true),(3,false)');
    await admin.query('CREATE TABLE cliente("IdCliente" integer PRIMARY KEY)');
    await admin.query(readFileSync(join(__dirname, 'migrations/031_crm_pipeline.sql'), 'utf8').split('CREATE TABLE IF NOT EXISTS venta_perdida')[0]);
    await admin.query(readFileSync(join(__dirname, 'migrations/089_solicitudes_web.sql'), 'utf8'));
    await admin.query(readFileSync(join(__dirname, 'migrations/090_conversion_solicitud_web.sql'), 'utf8'));
    await admin.query(readFileSync(join(__dirname, 'migrations/091_resolucion_solicitudes_web.sql'), 'utf8'));
    db = new DataSource({ type: 'postgres', ...(config.connectionString ? { url: config.connectionString } :
      { host: config.host, port: config.port, username: config.user, password: config.password, database: config.database }),
      ssl: config.ssl, entities: [], synchronize: false, extra: { options: `-c search_path=${schema}` } });
    await db.initialize();
    const service = new CrmSolicitudesWebService(db);
    const lead = { schemaVersion: 1, requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', origin: 'public-web',
      contact: { name: 'Fixture', channel: 'email', value: 'fixture@example.com' },
      items: [{ kind: 'reference', code: 'FIXTURE-1', quantity: 2 }], privacy: { accepted: true, version: 'fixture-v1' } };
    const fingerprint = 'a'.repeat(64);
    const concurrent = await Promise.all([service.receive(lead, fingerprint), service.receive(lead, fingerprint)]);
    assert.deepEqual(concurrent[0], concurrent[1]);
    assert.equal((await service.list(1, 25)).length, 1);
    assert.equal((await service.receiptStatus(lead.requestId)).contenido, 'Vigente');
    await assert.rejects(service.receiptStatus('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'), /no encontrada/);
    await assert.rejects(service.receive(lead, 'b'.repeat(64)), /ya utilizado/);
    const reviews = await Promise.allSettled([
      service.review(lead.requestId, 'Revisada', 1, 1), service.review(lead.requestId, 'Descartada', 1, 1)]);
    assert.equal(reviews.filter(result => result.status === 'fulfilled').length, 1);
    const convertLead = { ...lead, requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
    await service.receive(convertLead, fingerprint);
    await assert.rejects(service.convert(convertLead.requestId, 9, 1), /Actualiza/);
    await assert.rejects(service.convert(convertLead.requestId, 1, 999), /no activo/);
    await assert.rejects(service.convert(convertLead.requestId, 1, 1, 3), /no activo/);
    assert.equal((await db.query('SELECT * FROM crm_oportunidad')).length, 0);
    const conversions = await Promise.all([service.convert(convertLead.requestId, 1, 1, 2),service.convert(convertLead.requestId, 1, 1, 2)]);
    assert.deepEqual(conversions[0], conversions[1]);
    assert.equal((await db.query('SELECT * FROM crm_oportunidad')).length, 1);
    assert.equal((await db.query('SELECT * FROM crm_seguimiento')).length, 1);
    const [snapshot] = await db.query('SELECT piezas FROM crm_oportunidad_consulta_web');
    assert.deepEqual(snapshot.piezas, lead.items);
    assert.deepEqual((await service.snapshot(conversions[0].idOportunidad, 2, false)).piezas, lead.items);
    await assert.rejects(service.snapshot(conversions[0].idOportunidad, 3, false), /no disponible/);
    assert.ok(await service.snapshot(conversions[0].idOportunidad, 1, true));
    assert.equal((await db.query('SELECT id_responsable FROM crm_oportunidad'))[0].id_responsable, 2);
    assert.equal((await db.query('SELECT id_autor FROM crm_oportunidad_consulta_web'))[0].id_autor, 1);
    await service.convert(convertLead.requestId, 1, 1, 1);
    assert.equal((await db.query('SELECT id_responsable FROM crm_oportunidad'))[0].id_responsable, 2, 'Reintento no reasigna');
    await assert.rejects(service.review(convertLead.requestId, 'Descartada', 2, 1), /no vigente/);
    await db.query("UPDATE crm_solicitud_web SET expires_at=clock_timestamp()-interval '1 second'");
    assert.equal((await service.list(1, 25)).length, 0);
    const expiredStatus = await service.receiptStatus(lead.requestId);
    assert.equal(expiredStatus.contenido, 'Vencido');
    assert.ok(!Object.hasOwn(expiredStatus, 'payload'));
    assert.ok(!Object.hasOwn(expiredStatus, 'fingerprint'));
    await service.purgeExpired();
    const purgedStatus = await service.receiptStatus(convertLead.requestId);
    assert.equal(purgedStatus.contenido, 'Purgado');
    assert.equal(purgedStatus.idOportunidad, conversions[0].idOportunidad);
    assert.ok(!JSON.stringify(purgedStatus).includes('fixture@example.com'));
    const [row] = await db.query('SELECT payload,fingerprint FROM crm_solicitud_web WHERE request_id=$1',[lead.requestId]);
    assert.equal(row.payload, null);
    assert.equal(row.fingerprint, fingerprint);
    await service.receive(lead, fingerprint);
    assert.equal((await service.list(1, 25)).length, 0, 'Un reintento no restaura datos expirados');
    assert.deepEqual(await service.convert(convertLead.requestId, 1, 1),conversions[0], 'Reintento recupera vínculo después de purga');
    await db.query(`INSERT INTO crm_solicitud_web(request_id,fingerprint,payload,expires_at)
      SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,$2::jsonb,
      clock_timestamp()-interval '1 second' FROM generate_series(1,1001) AS n`, [fingerprint,JSON.stringify(lead)]);
    assert.equal((await service.purgeExpired()).purged,1000);
    assert.equal((await service.purgeExpired()).purged,1);
    assert.equal((await service.purgeExpired()).purged,0);
    const module=await Test.createTestingModule({controllers:[WebLeadBridgeController],providers:[{provide:CrmSolicitudesWebService,useValue:service}]}).compile();
    app=module.createNestApplication(); app.setGlobalPrefix('api/v1'); await app.listen(0,'127.0.0.1');
    const origin=await app.getUrl();
    const key=randomBytes(32);
    const bridge=createLeadBridge(origin,key);
    const request={...lead,requestId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',items:[{kind:'reference',code:'FIXTURE-BRIDGE',brand:'',application:'',quantity:3}]};
    delete request.origin;
    const normalized=validateLead(request,{schemaVersion:1,products:[]},'fixture-v1');
    const hash=leadFingerprint(request,{schemaVersion:1,products:[]},'fixture-v1',key);
    process.env.WEB_LEAD_BRIDGE_ENABLED='false';
    await assert.rejects(bridge(normalized,hash),/no confirmada/);
    process.env.WEB_LEAD_BRIDGE_KEY=key.toString('base64');
    process.env.WEB_LEAD_PRIVACY_VERSION='fixture-v1';
    process.env.WEB_LEAD_BRIDGE_ENABLED='true';
    const unsigned=await fetch(origin+'/api/v1/web-lead-bridge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lead:normalized,fingerprint:hash})});
    assert.equal(unsigned.status,401);
    const raw=JSON.stringify({lead:normalized,fingerprint:hash});
    const old=String(Date.now()-120000);
    const expiredSignature=createHmac('sha256',key).update(`web-lead-v1\n${old}\n${raw}`).digest('hex');
    const expired=await fetch(origin+'/api/v1/web-lead-bridge',{method:'POST',headers:{'Content-Type':'application/json','X-Web-Timestamp':old,'X-Web-Signature':expiredSignature},body:raw});
    assert.equal(expired.status,401);
    await assert.rejects(createLeadBridge(origin,randomBytes(32))(normalized,hash),/no confirmada/);
    await Promise.all([bridge(normalized,hash),bridge(normalized,hash)]);
    assert.equal((await service.list(1,25)).length,1,'HTTP firmado persiste una sola solicitud');
    await assert.rejects(bridge(normalized,'f'.repeat(64)),/no confirmada/);
    await verifyNativeFlow(bridge, key, db, service);
    await verifyBridgeRotation(origin, key, normalized,
      async () => (await db.query('SELECT payload,fingerprint,expires_at,estado,id_oportunidad FROM crm_solicitud_web WHERE request_id=$1', [normalized.requestId]))[0],
      async () => { await db.query("UPDATE crm_solicitud_web SET expires_at=clock_timestamp()-interval '1 second' WHERE request_id=$1", [normalized.requestId]); await service.purgeExpired(); });
    await verifyIntakeProfile(origin, 'http://127.0.0.1:4500', async () => (await db.query(`SELECT
      (SELECT count(*) FROM crm_solicitud_web) leads, (SELECT count(*) FROM crm_oportunidad) opportunities,
      (SELECT count(*) FROM crm_oportunidad_consulta_web) snapshots, (SELECT count(*) FROM crm_solicitud_web_resolucion) decisions`))[0]);
    await verifyResolutionFlow(service, db, lead);
    console.log('Puente HTTP firmado: cerrado, firma inválida, huella inválida y persistencia idempotente aprobados.');
    console.log('Bandeja web: conversión única, snapshot, historial, reintentos, versiones y purga aprobados en esquema aislado.');
  } finally {
    if(app) await app.close();
    for(const [key,value] of Object.entries(savedBridgeEnv)) {if(value===undefined) delete process.env[key]; else process.env[key]=value;}
    if (db?.isInitialized) await db.destroy();
    if (created && /^verify_web_inbox_[a-f0-9]{16}$/.test(schema)) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
}
main().catch(error => { console.error('Falló la verificación aislada de bandeja web:', error.name, error.code || '', error instanceof assert.AssertionError ? error.message : 'Error SQL o de servicio'); process.exitCode = 1; });
