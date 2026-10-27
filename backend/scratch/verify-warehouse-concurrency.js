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

    const [home] = await ds.query(
      `SELECT u.id_ubicacion id,u.id_almacen warehouse FROM almacen_ubicacion u JOIN almacen a ON a.id_almacen=u.id_almacen WHERE a.es_principal AND u.codigo='GENERAL' LIMIT 1`,
    );
    const destination = await service.createLocation({
      idAlmacen: home.warehouse,
      codigo: 'Q04-' + randomUUID().slice(0, 8),
    });
    async function concurrent(dto, work, idField) {
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          work(
            i % 2
              ? {
                  ...Object.fromEntries(Object.entries(dto).reverse()),
                  ...(dto.partidas
                    ? { partidas: [...dto.partidas].reverse() }
                    : {}),
                  requestId: dto.requestId.toUpperCase(),
                }
              : dto,
          ),
        ),
      );
      assert.equal(new Set(results.map((x) => x[idField])).size, 1);
      return results[0];
    }
    const transfer = {
      requestId: randomUUID(),
      idProducto: ids[0],
      idOrigen: home.id,
      idDestino: destination.idUbicacion,
      cantidad: 1,
      motivo: 'Q04 concurrente',
    };
    await concurrent(transfer, (d) => service.transfer(d), 'idTransferencia');
    assert.equal(
      (
        await ds.query(
          'SELECT cantidad::float8 n FROM inventario_ubicacion WHERE id_ubicacion=$1 AND id_producto=$2',
          [destination.idUbicacion, ids[0]],
        )
      )[0].n,
      1,
    );
    await assert.rejects(
      service.transfer({ ...transfer, cantidad: 2 }),
      (e) => e.getStatus() === 409,
    );
    await assert.rejects(
      service.transfer({
        ...transfer,
        idDestino: home.id,
        idOrigen: destination.idUbicacion,
      }),
      (e) => e.getStatus() === 409,
    );
    const concurrentCount = {
      requestId: randomUUID(),
      idUbicacion: home.id,
      partidas: [{ idProducto: ids[0], cantidadContada: 12 }],
    };
    const beforeCounts = await aligned();
    await concurrent(concurrentCount, (d) => service.count(d), 'idConteo');
    const afterCounts = await aligned();
    assert.equal(afterCounts[0].stock, 13);
    assert.equal(afterCounts[0].movements - beforeCounts[0].movements, 1);
    await assert.rejects(
      service.count({
        ...concurrentCount,
        partidas: [{ idProducto: ids[0], cantidadContada: 14 }],
      }),
      (e) => e.getStatus() === 409,
    );
    const capture = {
      ...concurrentCount,
      requestId: randomUUID(),
      tipo: 'Ciclico',
      ciego: true,
    };
    const captured = await concurrent(
      capture,
      (d) => service.createCount(d),
      'idConteo',
    );
    await assert.rejects(
      service.createCount({ ...capture, tipo: 'General' }),
      (e) => e.getStatus() === 409,
    );
    await assert.rejects(service.count(capture), (e) => e.getStatus() === 409);
    const approvals = await Promise.allSettled([
      service.resolveCount(captured.idConteo, { aprobar: true }),
      service.resolveCount(captured.idConteo, { aprobar: true }),
    ]);
    assert.equal(approvals.filter((x) => x.status === 'fulfilled').length, 1);
    assert.equal(
      approvals.filter(
        (x) => x.status === 'rejected' && x.reason.getStatus() === 409,
      ).length,
      1,
    );
    const kitDto = { requestId: randomUUID(), cantidad: 1 };
    const beforeKit = await aligned();
    await concurrent(
      kitDto,
      (d) => service.moveKit(ids[1], d, 'Armado'),
      'idMovimiento',
    );
    const afterKit = await aligned();
    assert.equal(afterKit[0].stock, beforeKit[0].stock - 2);
    assert.equal(afterKit[1].stock, beforeKit[1].stock + 1);
    assert.equal(afterKit[0].movements - beforeKit[0].movements, 1);
    await assert.rejects(
      service.moveKit(ids[1], { ...kitDto, cantidad: 2 }, 'Armado'),
      (e) => e.getStatus() === 409,
    );
    await assert.rejects(
      service.moveKit(ids[1], kitDto, 'Desarmado'),
      (e) => e.getStatus() === 409,
    );
    await assert.rejects(
      service.moveKit(ids[0], kitDto, 'Armado'),
      (e) => e.getStatus() === 409,
    );
    await ds.query('DELETE FROM operation_idempotency WHERE request_id=$1', [
      transfer.requestId,
    ]);
    await assert.rejects(
      service.transfer(transfer),
      (e) => e.getStatus() === 409,
    );
    async function physical() {
      return await ds.query(
        'SELECT id_producto,id_ubicacion,cantidad::float8 cantidad FROM inventario_ubicacion WHERE id_producto=ANY($1::int[]) ORDER BY id_producto,id_ubicacion',
        [ids],
      );
    }
    const beforeFail = await physical();
    await ds.query(
      `CREATE FUNCTION q04_request_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation_type LIKE 'almacen:%' THEN RAISE EXCEPTION 'isolated idempotency rollback'; END IF; RETURN NEW; END $$`,
    );
    await ds.query(
      'CREATE TRIGGER q04_request_fail BEFORE INSERT ON operation_idempotency FOR EACH ROW EXECUTE FUNCTION q04_request_fail()',
    );
    const failDto = { ...transfer, requestId: randomUUID() };
    await assert.rejects(service.transfer(failDto));
    assert.deepEqual(await physical(), beforeFail);
    const beforeFinancial = await aligned();
    await assert.rejects(
      service.count({
        ...concurrentCount,
        requestId: randomUUID(),
        partidas: [{ idProducto: ids[0], cantidadContada: 25 }],
      }),
    );
    assert.deepEqual(await aligned(), beforeFinancial);
    assert.deepEqual(await physical(), beforeFail);
    await assert.rejects(
      service.moveKit(
        ids[1],
        { requestId: randomUUID(), cantidad: 1 },
        'Armado',
      ),
    );
    assert.deepEqual(await aligned(), beforeFinancial);
    assert.deepEqual(await physical(), beforeFail);
    await ds.query('DROP TRIGGER q04_request_fail ON operation_idempotency');
    await concurrent(failDto, (d) => service.transfer(d), 'idTransferencia');
    // Carreras sobre la misma existencia física: conteo y kit usan producto antes de ubicación.
    const race = await Promise.allSettled([
      service.count({
        ...concurrentCount,
        requestId: randomUUID(),
        partidas: [{ idProducto: ids[0], cantidadContada: 20 }],
      }),
      service.moveKit(
        ids[1],
        { requestId: randomUUID(), cantidad: 1 },
        'Armado',
      ),
    ]);
    assert.equal(race.filter((x) => x.status === 'fulfilled').length, 2);
    await aligned();
    const durationArg = process.argv.find((x) => x.startsWith('--duration='));
    const duration = durationArg ? Number(durationArg.slice(11)) : 120;
    assert.ok(Number.isInteger(duration) && duration >= 5 && duration <= 600);
    const pgBefore = (
      await ds.query(
        'SELECT deadlocks,xact_commit,xact_rollback FROM pg_stat_database WHERE datname=current_database()',
      )
    )[0];
    const metrics = {
      samples: 0,
      maxConnections: 0,
      maxWaiting: 0,
      maxTransactionSeconds: 0,
      maxDeadTuples: 0,
      autovacuumRuns: 0,
    };
    const latencies = [];
    let reads = 0,
      writes = 0;
    const started = Date.now(),
      deadline = started + duration * 1000;
    async function measured(work) {
      const at = performance.now();
      await work();
      latencies.push(performance.now() - at);
    }
    const sampler = (async () => {
      while (Date.now() < deadline) {
        const [r] = await ds.query(
          `SELECT count(*)::int connections,count(*) FILTER(WHERE wait_event_type='Lock')::int waiting,coalesce(max(extract(epoch FROM now()-xact_start)),0)::float8 age FROM pg_stat_activity WHERE datname=current_database()`,
        );
        const [t] = await ds.query(
          'SELECT coalesce(sum(n_dead_tup),0)::int dead,coalesce(sum(autovacuum_count),0)::int vacuum FROM pg_stat_user_tables',
        );
        metrics.samples++;
        metrics.maxConnections = Math.max(
          metrics.maxConnections,
          r.connections,
        );
        metrics.maxWaiting = Math.max(metrics.maxWaiting, r.waiting);
        metrics.maxTransactionSeconds = Math.max(
          metrics.maxTransactionSeconds,
          r.age,
        );
        metrics.maxDeadTuples = Math.max(metrics.maxDeadTuples, t.dead);
        metrics.autovacuumRuns = Math.max(metrics.autovacuumRuns, t.vacuum);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    })();
    const workers = [
      (async () => {
        while (Date.now() < deadline) {
          for (const tipo of ['Armado', 'Desarmado']) {
            await measured(() =>
              service.moveKit(
                ids[1],
                { requestId: randomUUID(), cantidad: 1 },
                tipo,
              ),
            );
            writes++;
          }
        }
      })(),
      (async () => {
        while (Date.now() < deadline) {
          for (const direction of [true, false]) {
            await measured(() =>
              service.transfer({
                requestId: randomUUID(),
                idProducto: ids[0],
                idOrigen: direction ? home.id : destination.idUbicacion,
                idDestino: direction ? destination.idUbicacion : home.id,
                cantidad: 0.25,
                motivo: 'Q04 carga local',
              }),
            );
            writes++;
          }
        }
      })(),
      ...Array.from({ length: 4 }, () =>
        (async () => {
          while (Date.now() < deadline) {
            await measured(() =>
              ds.transaction('REPEATABLE READ', async (m) => {
                await m.query('SET TRANSACTION READ ONLY');
                const rows = await m.query(
                  `SELECT p."Existencia"::float8 stock,(SELECT coalesce(sum(cantidad),0) FROM inventario_ubicacion WHERE id_producto=p."IdProducto")::float8 physical FROM producto p WHERE p."IdProducto"=ANY($1::int[]) ORDER BY p."IdProducto"`,
                  [ids],
                );
                for (const r of rows) assert.equal(r.stock, r.physical);
                await m.query(
                  'SELECT count(*) FROM kardex WHERE id_producto=ANY($1::int[])',
                  [ids],
                );
              }),
            );
            reads++;
          }
        })(),
      ),
    ];
    const outcomes = await Promise.allSettled([...workers, sampler]);
    for (const o of outcomes) if (o.status === 'rejected') throw o.reason;
    await aligned();
    latencies.sort((a, b) => a - b);
    const pgAfter = (
      await ds.query(
        'SELECT deadlocks,xact_commit,xact_rollback FROM pg_stat_database WHERE datname=current_database()',
      )
    )[0];
    assert.equal(Number(pgAfter.deadlocks) - Number(pgBefore.deadlocks), 0);
    const load = {
      durationSeconds: Math.round((Date.now() - started) / 1000),
      reads,
      writes,
      p95Ms: Number(latencies[Math.floor(latencies.length * 0.95)].toFixed(2)),
      postgres: metrics,
      deadlocks: 0,
      snapshotMismatches: 0,
    };
    const idle = (
      await ds.query(
        "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND state LIKE 'idle in transaction%'",
      )
    )[0].n;
    assert.equal(idle, 0);
    report = {
      warehouseConcurrentReplays: true,
      warehousePayloadConflicts409: true,
      warehouseLegacyConflict409: true,
      transferRollbackAndRetry: true,
      countKitRaceWithoutDeadlock: true,
      mixedLoad: load,
      processPeakRssBytes: process.resourceUsage().maxRSS * 1024,
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
        'Servicios reales de almacén y snapshots SQL; no HTTP ni carga de todas las áreas.',
        'GarantiaService actual no modifica existencias.',
        'Carga acotada de almacén; mismo proceso para generador/lectores, sin medir CPU del proceso PostgreSQL. No repara Kardex histórico ni certifica todos los flujos.',
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
    path.join(__dirname, '../../docs/q0453c2c3a-warehouse.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    'Concurrencia de almacén y carga mixta aprobadas; base eliminada.',
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
