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

    const { AlmacenService } = require('../dist/almacen/almacen.service');
    const {
      updateManagedStock,
    } = require('../dist/common/database/managed-stock');
    const [catalog] = await ds.query(
      'SELECT min("IdObjetoImpuesto") id FROM objetoimpuesto',
    );
    const [location] = await ds.query(
      'SELECT id_ubicacion id FROM almacen_ubicacion WHERE activa ORDER BY id_ubicacion LIMIT 1',
    );
    const ids = [];
    for (let i = 0; i < 2; i++) {
      const [row] = await ds.query(
        `INSERT INTO producto("Codigo","Descripcion","IdObjetoImpuesto","PrecioUnitario","Existencia") VALUES($1,'Fixture Kardex gestionado',$2,10,10) RETURNING "IdProducto" id`,
        ['Q04-' + randomUUID().slice(0, 20), catalog.id],
      );
      ids.push(row.id);
    }
    const service = new AlmacenService(ds);
    async function state() {
      return await ds.query(
        `SELECT p."IdProducto" id,p."Existencia"::float8 stock,(SELECT coalesce(sum(cantidad),0) FROM inventario_ubicacion WHERE id_producto=p."IdProducto")::float8 physical,(SELECT count(*)::int FROM kardex WHERE id_producto=p."IdProducto") movements FROM producto p WHERE p."IdProducto"=ANY($1::int[]) ORDER BY p."IdProducto"`,
        [ids],
      );
    }
    async function aligned() {
      const rows = await state();
      for (const r of rows) assert.equal(r.stock, r.physical);
      return rows;
    }
    const initial = await aligned();
    const countDto = {
      requestId: randomUUID(),
      idUbicacion: location.id,
      partidas: [{ idProducto: ids[0], cantidadContada: 8 }],
    };
    const count = await service.count(countDto);
    await service.count(countDto);
    let rows = await aligned();
    assert.equal(rows[0].stock, 8);
    assert.equal(rows[0].movements - initial[0].movements, 1);
    const pending = await service.createCount({
      ...countDto,
      requestId: randomUUID(),
      tipo: 'Ciclico',
      ciego: true,
      partidas: [{ idProducto: ids[0], cantidadContada: 12 }],
    });
    await service.resolveCount(pending.idConteo, { aprobar: true });
    rows = await aligned();
    assert.equal(rows[0].stock, 12);
    assert.equal(rows[0].movements - initial[0].movements, 2);
    await assert.rejects(
      service.resolveCount(pending.idConteo, { aprobar: true }),
      (e) => e.getStatus() === 409,
    );
    await service.saveKit(ids[1], {
      componentes: [{ idProducto: ids[0], cantidad: 2 }],
    });
    const assembly = { requestId: randomUUID(), cantidad: 2 };
    await service.moveKit(ids[1], assembly, 'Armado');
    await service.moveKit(ids[1], assembly, 'Armado');
    rows = await aligned();
    assert.equal(rows[0].stock, 8);
    assert.equal(rows[1].stock, 12);
    assert.equal(rows[0].movements - initial[0].movements, 3);
    assert.equal(rows[1].movements - initial[1].movements, 1);
    await service.moveKit(
      ids[1],
      { requestId: randomUUID(), cantidad: 1 },
      'Desarmado',
    );
    const saved = await aligned();
    assert.equal(saved[0].stock, 10);
    assert.equal(saved[1].stock, 11);
    await ds.query(
      `CREATE FUNCTION q04_stock_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id_producto=${ids[1]} THEN RAISE EXCEPTION 'isolated stock rollback'; END IF; RETURN NEW; END $$`,
    );
    await ds.query(
      'CREATE TRIGGER q04_stock_fail BEFORE INSERT ON kardex FOR EACH ROW EXECUTE FUNCTION q04_stock_fail()',
    );
    const failing = { requestId: randomUUID(), cantidad: 1 };
    await assert.rejects(service.moveKit(ids[1], failing, 'Armado'));
    assert.deepEqual(await aligned(), saved);
    await ds.query('DROP TRIGGER q04_stock_fail ON kardex');
    await service.moveKit(ids[1], failing, 'Armado');
    const beforeManual = await aligned();
    await ds.transaction(async (m) => {
      await m.query(
        'UPDATE producto SET "Existencia"="Existencia"+1,"PrecioUnitario"="PrecioUnitario"+1 WHERE "IdProducto"=$1',
        [ids[0]],
      );
    });
    const afterManual = await aligned();
    assert.equal(afterManual[0].movements - beforeManual[0].movements, 2);
    await ds.transaction(async (m) => {
      await m.query(
        "SELECT set_config('app.stock_movement_managed','true',true),set_config('app.skip_location_stock_sync','true',true)",
      );
      await updateManagedStock(m, ids[0], afterManual[0].stock, true);
      const [flags] = await m.query(
        "SELECT current_setting('app.stock_movement_managed') managed,current_setting('app.skip_location_stock_sync') skip",
      );
      assert.deepEqual(flags, { managed: 'true', skip: 'true' });
    });
    await assert.rejects(
      updateManagedStock(ds.manager, ids[0], 0),
      /transacción activa/,
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
      directCountSingleKardex: true,
      approvedCountSingleKardex: true,
      kitAssemblyDisassemblySingleKardex: true,
      replaysNoExtraMovement: true,
      kitFailureRollsBackAllProductsAndLocations: true,
      retryAfterRollback: true,
      manualPriceAndStockStillAudited: true,
      nestedFlagsRestored: true,
      transactionRequired: true,
      physicalStockAligned: true,
      idleTransactions: idle,
      limitations: [
        'Servicios reales, no HTTP ni carga prolongada.',
        'GarantiaService actual no modifica existencias.',
        'No repara Kardex histórico; no certifica concurrencia de todos los flujos.',
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
    path.join(__dirname, '../../docs/q0453c2c2b2b-stock.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    'Kardex gestionado, ubicaciones, rollback y auditoría manual aprobados; base eliminada.',
  );
}
main().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
