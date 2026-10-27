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

    const { CobranzaService } = require('../dist/pago/cobranza.service');
    const [client] = await ds.query('SELECT min("IdCliente") id FROM cliente');
    assert.ok(client.id);
    const [invoice] = await ds.query(
      `INSERT INTO factura(id_cliente,rfc_receptor,nombre_receptor,codigo_postal_receptor,regimen_fiscal_receptor_clave,uso_cfdi_clave,subtotal,total,saldo_pendiente,estatus) VALUES($1,'XAXX010101000','Fixture pagos aislado','89000','601','G03',100,100,100,'Pendiente') RETURNING id_factura id`,
      [client.id],
    );
    const service = new CobranzaService(ds);
    async function state() {
      const [row] = await ds.query(
        `SELECT (SELECT saldo_pendiente FROM factura WHERE id_factura=$1)::float8 balance,(SELECT count(*) FROM pago WHERE id_factura=$1)::int payments,(SELECT caja_chica FROM saldos ORDER BY id_saldo LIMIT 1)::float8 cash`,
        [invoice.id],
      );
      return row;
    }
    const initial = await state();
    const dto = (amount) => ({
      requestId: randomUUID(),
      idFactura: invoice.id,
      monto: amount,
      formaPago: 'Efectivo',
      referencia: 'Q04 aislado',
      notas: '',
    });
    const first = dto(10);
    const payments = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        service.registrarPago(
          i % 2
            ? Object.fromEntries(
                Object.entries({
                  ...first,
                  requestId: first.requestId.toUpperCase(),
                }).reverse(),
              )
            : first,
        ),
      ),
    );
    assert.equal(new Set(payments.map((x) => x.idPago)).size, 1);
    assert.deepEqual(await state(), {
      balance: 90,
      payments: 1,
      cash: initial.cash + 10,
    });
    const afterFirst = await state();
    await assert.rejects(
      service.registrarPago({ ...first, monto: 11 }),
      (e) => e.getStatus() === 409,
    );
    await assert.rejects(
      service.registrarPago({ ...first, idFactura: invoice.id + 999999 }),
      (e) => e.getStatus() === 409,
    );
    assert.deepEqual(await state(), afterFirst);
    await ds.query(
      `CREATE FUNCTION q04_fail_payment() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.operation_type='pago' THEN RAISE EXCEPTION 'Q04 controlled failure'; END IF; RETURN NEW; END$$;CREATE TRIGGER q04_payment_failure BEFORE INSERT ON operation_idempotency FOR EACH ROW EXECUTE FUNCTION q04_fail_payment()`,
    );
    const retry = dto(10);
    await assert.rejects(
      service.registrarPago(retry),
      (e) => e.code === 'P0001',
    );
    assert.deepEqual(await state(), afterFirst);
    assert.equal(
      Number(
        (
          await ds.query(
            'SELECT count(*) n FROM operation_idempotency WHERE request_id=$1',
            [retry.requestId],
          )
        )[0].n,
      ),
      0,
    );
    await ds.query(
      'DROP TRIGGER q04_payment_failure ON operation_idempotency;DROP FUNCTION q04_fail_payment()',
    );
    const recovered = await Promise.all(
      Array.from({ length: 8 }, () => service.registrarPago(retry)),
    );
    assert.equal(new Set(recovered.map((x) => x.idPago)).size, 1);
    assert.deepEqual(await state(), {
      balance: 80,
      payments: 2,
      cash: initial.cash + 20,
    });
    const competing = await Promise.allSettled([
      service.registrarPago(dto(45)),
      service.registrarPago(dto(45)),
    ]);
    assert.equal(competing.filter((x) => x.status === 'fulfilled').length, 1);
    assert.equal(
      competing.find((x) => x.status === 'rejected').reason.getStatus(),
      400,
    );
    assert.deepEqual(await state(), {
      balance: 35,
      payments: 3,
      cash: initial.cash + 65,
    });
    const final = dto(35);
    await service.registrarPago(final);
    const paid = await Promise.all(
      Array.from({ length: 8 }, () => service.registrarPago(final)),
    );
    assert.equal(new Set(paid.map((x) => x.idPago)).size, 1);
    assert.deepEqual(await state(), {
      balance: 0,
      payments: 4,
      cash: initial.cash + 100,
    });
    assert.equal(
      (
        await ds.query(
          'SELECT estatus::text status FROM factura WHERE id_factura=$1',
          [invoice.id],
        )
      )[0].status,
      'Pagada',
    );
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
      singlePaymentEffect: true,
      canonicalPayloadAndUuid: true,
      changedAmountAndInvoice409: true,
      rollbackPaymentBalanceAndCash: true,
      retryAfterRollback: true,
      competingOverpayment400: true,
      paidInvoiceRetry: true,
      final: { balance: 0, payments: 4, cashIncrease: 100 },
      idleTransactions: idle,
      limitations: [
        'Servicios TypeORM/PostgreSQL reales; no HTTP, UI ni carga prolongada.',
        'requestId opcional por compatibilidad: llamadas sin clave no adquieren idempotencia.',
        'No cubre REP, pagos a proveedores ni ventas; no caída física de PostgreSQL.',
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
    path.join(__dirname, '../../docs/q0453c2c2a-payments.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    'Concurrencia de cobros, payload, rollback y reintento aprobados; base eliminada.',
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
