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
const {
  AbastecimientoService,
} = require('../dist/abastecimiento/abastecimiento.service');
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
    const [catalog] = await ds.query(
      'SELECT (SELECT min("IdProveedor") FROM proveedor) supplier,(SELECT min("IdObjetoImpuesto") FROM objetoimpuesto) tax',
    );
    assert.ok(catalog.supplier && catalog.tax);
    const [product] = await ds.query(
      'INSERT INTO producto("Codigo","Descripcion","IdObjetoImpuesto","PrecioUnitario","Existencia") VALUES($1,$2,$3,10,0) RETURNING "IdProducto" AS id',
      [
        'Q04-' + randomUUID().slice(0, 20),
        'Fixture concurrencia abastecimiento',
        catalog.tax,
      ],
    );
    const initialKardex = Number(
      (
        await ds.query('SELECT count(*) n FROM kardex WHERE id_producto=$1', [
          product.id,
        ])
      )[0].n,
    );
    const service = new AbastecimientoService(ds),
      requestDto = () => ({
        requestId: randomUUID(),
        motivo: 'Q04 aislado',
        partidas: [
          {
            idProducto: product.id,
            cantidad: 10,
            costoEstimado: 10,
            origen: 'Manual',
          },
        ],
      });
    // Control determinista: ambas transacciones leen inexistencia antes de insertar, omitiendo solo el nuevo lock.
    let reads = 0,
      release;
    const gate = new Promise((r) => (release = r));
    const control = new AbastecimientoService({
      transaction: (work) =>
        ds.transaction((manager) =>
          work({
            query: async (sql, params) => {
              if (sql.includes('pg_advisory_xact_lock')) return [];
              const result = await manager.query(sql, params);
              if (sql.includes('FROM solicitud_compra WHERE request_id')) {
                if (++reads === 2) release();
                await gate;
              }
              return result;
            },
          }),
        ),
    });
    const unsafe = requestDto(),
      race = await Promise.allSettled([
        control.createRequest(unsafe),
        control.createRequest(unsafe),
      ]);
    assert.equal(race.filter((x) => x.status === 'fulfilled').length, 1);
    assert.equal(
      race.find((x) => x.status === 'rejected').reason.code,
      '23505',
    );
    const request = requestDto(),
      requests = await Promise.all(
        Array.from({ length: 8 }, () => service.createRequest(request)),
      );
    assert.equal(new Set(requests.map((x) => x.idSolicitud)).size, 1);
    await service.authorizeRequest(requests[0].idSolicitud);
    const orderDto = {
      requestId: randomUUID(),
      idSolicitud: requests[0].idSolicitud,
      idProveedor: catalog.supplier,
      partidas: [
        {
          idProducto: product.id,
          cantidad: 10,
          costoUnitario: 10,
          tasaIva: 0.16,
        },
      ],
    };
    const orders = await Promise.all(
      Array.from({ length: 8 }, () => service.createOrder(orderDto)),
    );
    assert.equal(new Set(orders.map((x) => x.idOrden)).size, 1);
    const order = orders[0].idOrden;
    const [line] = await ds.query(
      'SELECT id_detalle id FROM orden_compra_detalle WHERE id_orden=$1',
      [order],
    );
    const receiptDto = (quantity) => ({
      requestId: randomUUID(),
      referencia: 'Q04 aislado',
      partidas: [{ idDetalle: line.id, cantidad: quantity }],
    });
    const first = receiptDto(3),
      receipts = await Promise.all(
        Array.from({ length: 8 }, () => service.receive(order, first)),
      );
    assert.equal(new Set(receipts.map((x) => x.idRecepcion)).size, 1);
    async function state() {
      const [row] = await ds.query(
        `SELECT (SELECT "Existencia" FROM producto WHERE "IdProducto"=$1)::float8 stock,(SELECT cantidad_recibida FROM orden_compra_detalle WHERE id_detalle=$2)::float8 received,(SELECT count(*) FROM kardex WHERE id_producto=$1)::int kardex,(SELECT count(*) FROM recepcion_compra WHERE id_orden=$3)::int receipts`,
        [product.id, line.id, order],
      );
      row.kardex -= initialKardex;
      const locations = Number(
        (
          await ds.query(
            'SELECT COALESCE(sum(cantidad),0) n FROM inventario_ubicacion WHERE id_producto=$1',
            [product.id],
          )
        )[0].n,
      );
      assert.equal(locations, row.stock);
      return row;
    }
    assert.deepEqual(await state(), {
      stock: 3,
      received: 3,
      kardex: 1,
      receipts: 1,
    });
    await ds.query(
      `CREATE FUNCTION q04_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Q04 controlled failure';END $$;CREATE TRIGGER q04_failure BEFORE INSERT ON recepcion_compra_detalle FOR EACH ROW EXECUTE FUNCTION q04_fail_receipt()`,
    );
    const retry = receiptDto(2),
      before = await state();
    await assert.rejects(
      service.receive(order, retry),
      (e) => e.code === 'P0001',
    );
    assert.deepEqual(await state(), before);
    assert.equal(
      Number(
        (
          await ds.query(
            'SELECT count(*) n FROM recepcion_compra WHERE request_id=$1',
            [retry.requestId],
          )
        )[0].n,
      ),
      0,
    );
    await ds.query(
      'DROP TRIGGER q04_failure ON recepcion_compra_detalle;DROP FUNCTION q04_fail_receipt()',
    );
    const retried = await Promise.all(
      Array.from({ length: 8 }, () => service.receive(order, retry)),
    );
    assert.equal(new Set(retried.map((x) => x.idRecepcion)).size, 1);
    assert.deepEqual(await state(), {
      stock: 5,
      received: 5,
      kardex: 2,
      receipts: 2,
    });
    const competing = await Promise.allSettled([
      service.receive(order, receiptDto(4)),
      service.receive(order, receiptDto(4)),
    ]);
    assert.equal(competing.filter((x) => x.status === 'fulfilled').length, 1);
    assert.equal(
      competing.find((x) => x.status === 'rejected').reason.getStatus(),
      400,
    );
    assert.deepEqual(await state(), {
      stock: 9,
      received: 9,
      kardex: 3,
      receipts: 3,
    });
    const last = receiptDto(1);
    await service.receive(order, last);
    await service.receive(order, last);
    assert.deepEqual(await state(), {
      stock: 10,
      received: 10,
      kardex: 4,
      receipts: 4,
    });
    assert.equal(
      (
        await ds.query('SELECT estado FROM orden_compra WHERE id_orden=$1', [
          order,
        ])
      )[0].estado,
      'Recibida',
    );
    const costDto = {
      requestId: randomUUID(),
      tipo: 'Flete',
      monto: 3,
      criterio: 'Cantidad',
    };
    const costs = await Promise.all(
      Array.from({ length: 8 }, () =>
        service.addReceiptCost(receipts[0].idRecepcion, costDto),
      ),
    );
    assert.equal(new Set(costs.map((x) => x.idCosto)).size, 1);
    const [receiptLine] = await ds.query(
      'SELECT id_detalle id,costo_unitario::float8 cost FROM recepcion_compra_detalle WHERE id_recepcion=$1',
      [receipts[0].idRecepcion],
    );
    assert.equal(receiptLine.cost, 11);
    const returnDto = {
      requestId: randomUUID(),
      idRecepcion: receipts[0].idRecepcion,
      motivo: 'Q04 devolución aislada',
      partidas: [{ idRecepcionDetalle: receiptLine.id, cantidad: 1 }],
    };
    const returns = await Promise.all(
      Array.from({ length: 8 }, () => service.returnToProvider(returnDto)),
    );
    assert.equal(new Set(returns.map((x) => x.idDevolucion)).size, 1);
    assert.deepEqual(await state(), {
      stock: 9,
      received: 10,
      kardex: 5,
      receipts: 4,
    });
    const idle = (
      await ds.query(
        "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND state LIKE 'idle in transaction%'",
      )
    )[0].n;
    assert.equal(idle, 0);
    const finalState = await state();
    await ds.query(
      'UPDATE producto SET "Existencia"=12,"PrecioUnitario"=11 WHERE "IdProducto"=$1',
      [product.id],
    );
    assert.deepEqual(await state(), {
      stock: 12,
      received: 10,
      kardex: 7,
      receipts: 4,
    });
    report = {
      generatedAt: new Date().toISOString(),
      node: process.versions.node,
      concurrentCallers: 8,
      controlRace23505: true,
      requestOrderReceiptSingleEffect: true,
      rollbackAfterStockAndKardex: true,
      retryAfterRollback: true,
      competingOverReceiptRejected: true,
      finalState,
      locationSync: true,
      manualStockAndPriceAudit: true,
      closedOrderRetry: true,
      costAndReturnSingleEffect: true,
      idleTransactions: idle,
      limitations: [
        'Servicios TypeORM/PostgreSQL reales de abastecimiento; no HTTP ni carga prolongada.',
        'No prueba pagos/ventas, backorders ni fingerprints de payload.',
        'Fallo SQL controlado, no caída física de PostgreSQL/PAC.',
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
    path.join(__dirname, '../../docs/q0453c2c1-business.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    'Concurrencia, rollback, reintento y límite de recepción aprobados; base eliminada.',
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
