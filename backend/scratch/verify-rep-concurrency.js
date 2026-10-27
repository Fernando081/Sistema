require('reflect-metadata');
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto'),
  { execFileSync } = require('node:child_process'),
  { Client } = require('pg'),
  { DataSource } = require('typeorm');
const { databaseConfig } = require('../db-config'),
  { findPgTool, postgresEnvironment } = require('../backup');
async function main() {
  assert.equal(process.versions.node.split('.')[0], '24');
  const arg = process.argv.find((x) => x.startsWith('--backup='));
  assert.ok(arg, 'Falta --backup=RUTA');
  const dump = path.resolve(arg.slice(9)),
    root = path.resolve(__dirname, '../../.backups');
  assert.ok(dump.startsWith(root + path.sep) && fs.existsSync(dump));
  const base = databaseConfig(),
    admin = new Client(base),
    name = `sistema_business_${Date.now()}_${randomBytes(3).toString('hex')}`;
  assert.match(name, /^sistema_business_\d+_[a-f0-9]{6}$/);
  let created = false,
    ds,
    report;
  await admin.connect();
  const options = { ...base, database: name };
  if (base.connectionString) {
    const u = new URL(base.connectionString);
    u.pathname = '/' + name;
    options.connectionString = u.toString();
  }
  try {
    assert.notEqual(
      name,
      (await admin.query('SELECT current_database() name')).rows[0].name,
    );
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    created = true;
    const env = { ...postgresEnvironment(), DB_NAME: name, PGDATABASE: name };
    if (options.connectionString) env.DATABASE_URL = options.connectionString;
    else delete env.DATABASE_URL;
    const child = {
      env,
      windowsHide: true,
      stdio: 'pipe',
      timeout: 180000,
      cwd: path.resolve(__dirname, '..'),
    };
    execFileSync(
      findPgTool('pg_restore'),
      ['--exit-on-error', '--no-owner', '--no-acl', '--dbname', name, dump],
      child,
    );
    execFileSync(
      process.execPath,
      [path.join(__dirname, '../run-migrations.js'), '--check'],
      child,
    );
    execFileSync(
      process.execPath,
      [path.join(__dirname, '../run-migrations.js')],
      child,
    );
    ds = new DataSource({
      type: 'postgres',
      ...(options.connectionString
        ? { url: options.connectionString }
        : {
            host: base.host,
            port: Number(base.port),
            username: base.user,
            password: base.password,
            database: name,
          }),
      ssl: base.ssl,
      extra: {
        max: 8,
        connectionTimeoutMillis: 5000,
        options: '-c statement_timeout=15000 -c lock_timeout=5000',
      },
    });
    await ds.initialize();
    assert.equal(
      (await ds.query('SELECT current_database() name'))[0].name,
      name,
    );

    const { RegistroRepService } = require('../dist/pago/registro-rep.service');
    const [client] = await ds.query('SELECT min("IdCliente") id FROM cliente');
    const [method] = await ds.query(
      `SELECT "IdMetodoDePago" id FROM metododepago WHERE "Clave"='PPD' LIMIT 1`,
    );
    assert.ok(client.id && method.id);
    const ids = [];
    for (let i = 0; i < 2; i++) {
      const [row] = await ds.query(
        `INSERT INTO factura(id_cliente,rfc_receptor,nombre_receptor,codigo_postal_receptor,regimen_fiscal_receptor_clave,uso_cfdi_clave,subtotal,total,saldo_pendiente,estatus,id_metodo_pago,moneda) VALUES($1,'XAXX010101000','Fixture REP aislado','89000','601','G03',100,100,100,'Pendiente',$2,'MXN') RETURNING id_factura id`,
        [client.id, method.id],
      );
      ids.push(row.id);
    }
    const service = new RegistroRepService(ds);
    const dto = {
      requestId: randomUUID(),
      idCliente: Number(client.id),
      fechaPago: '2026-10-02',
      formaPago: 'Efectivo',
      moneda: 'MXN',
      montoTotal: 20,
      facturas: ids.map((idFactura) => ({ idFactura, montoSaldado: 10 })),
    };
    async function state() {
      return (
        await ds.query(
          `SELECT (SELECT sum(saldo_pendiente) FROM factura WHERE id_factura=ANY($1::int[]))::float8 balance,(SELECT count(*) FROM pago WHERE id_factura=ANY($1::int[]))::int payments,(SELECT count(*) FROM rep_factura WHERE id_factura=ANY($1::int[]))::int lines,(SELECT caja_chica FROM saldos ORDER BY id_saldo LIMIT 1)::float8 cash`,
          [ids],
        )
      )[0];
    }
    const initial = await state();
    const result = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        service.registrarRepComplejo(
          i % 2
            ? {
                ...dto,
                requestId: dto.requestId.toUpperCase(),
                facturas: [...dto.facturas].reverse(),
              }
            : dto,
        ),
      ),
    );
    assert.equal(new Set(result.map((x) => x.idRep)).size, 1);
    const saved = await state();
    assert.equal(saved.balance, 180);
    assert.equal(saved.payments, 2);
    assert.equal(saved.lines, 2);
    for (const change of [
      { fechaPago: '2026-10-01' },
      { montoTotal: 22 },
      { formaPago: 'Transferencia' },
    ])
      await assert.rejects(
        service.registrarRepComplejo({ ...dto, ...change }),
        (e) => e.getStatus() === 409,
      );
    assert.deepEqual(await state(), saved);
    await ds.query(
      `CREATE FUNCTION q04_rep_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation_type='rep' THEN RAISE EXCEPTION 'isolated rollback probe'; END IF; RETURN NEW; END $$`,
    );
    await ds.query(
      'CREATE TRIGGER q04_rep_fail BEFORE INSERT ON operation_idempotency FOR EACH ROW EXECUTE FUNCTION q04_rep_fail()',
    );
    const retry = { ...dto, requestId: randomUUID() };
    await assert.rejects(service.registrarRepComplejo(retry));
    assert.deepEqual(await state(), saved);
    assert.equal(
      (
        await ds.query(
          'SELECT count(*)::int n FROM operation_idempotency WHERE request_id=$1',
          [retry.requestId],
        )
      )[0].n,
      0,
    );
    await ds.query('DROP TRIGGER q04_rep_fail ON operation_idempotency');
    await Promise.all(
      Array.from({ length: 8 }, () => service.registrarRepComplejo(retry)),
    );
    const finalDto = {
      ...dto,
      requestId: randomUUID(),
      montoTotal: 160,
      facturas: ids.map((idFactura) => ({ idFactura, montoSaldado: 80 })),
    };
    const paid = await service.registrarRepComplejo(finalDto);
    assert.equal(
      (await service.registrarRepComplejo(finalDto)).idRep,
      paid.idRep,
    );
    const final = await state();
    assert.equal(final.balance, 0);
    assert.equal(final.payments, 6);
    assert.equal(final.lines, 6);
    const idle = (
      await ds.query(
        "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND state LIKE 'idle in transaction%'",
      )
    )[0].n;
    assert.equal(idle, 0);
    report = {
      generatedAt: new Date().toISOString(),
      node: process.versions.node,
      concurrentCallers: 8,
      singleRepEffect: true,
      canonicalInvoiceOrderAndUuid: true,
      changedPayload409: true,
      atomicRollback: true,
      retryAfterRollback: true,
      fullyPaidReplay: true,
      final: {
        balance: final.balance,
        payments: final.payments,
        lines: final.lines,
        cashIncrease: final.cash - initial.cash,
      },
      idleTransactions: idle,
      limitations: [
        'Servicios reales en base restaurada; no HTTP, PAC ni carga prolongada.',
        'requestId opcional; formulario conserva clave solo durante su instancia.',
      ],
    };
  } finally {
    try {
      if (ds?.isInitialized) await ds.destroy();
    } finally {
      try {
        if (created) {
          assert.match(name, /^sistema_business_\d+_[a-f0-9]{6}$/);
          await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
        }
      } finally {
        await admin.end();
      }
    }
  }
  fs.writeFileSync(
    path.join(__dirname, '../../docs/q0453c2c2b2a-rep.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    'Concurrencia REP, payload, rollback y reintento aprobados; base eliminada.',
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
