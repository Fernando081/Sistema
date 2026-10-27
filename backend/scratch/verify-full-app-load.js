const { localLoadFetch, readLoadBody } = require('./local-load-fetch');
/* Q04.5.3c2c3c: complete AppModule and paced mixed business load in an owned copy. */
require('reflect-metadata');
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto'),
  { execFileSync } = require('node:child_process');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { Client } = require('pg'),
  { DataSource } = require('typeorm'),
  { Test } = require('@nestjs/testing');
const { databaseConfig } = require('../db-config'),
  { findPgTool, postgresEnvironment } = require('../backup'),
  { fixtures } = require('./benchmark-lists');
const load = (file, name) => require('../dist/' + file)[name];
const AuthUser = load('auth/auth-user.entity', 'AuthUser');
const configureApp = load('configure-app', 'configureApp');
const domains = [
  ['cliente', 'cliente/pagina', 'cliente/cliente'],
  ['proveedor', 'proveedores/pagina', 'proveedor/proveedor'],
  ['producto', 'producto', 'producto/producto'],
  ['cotizacion', 'cotizacion', 'cotizacion/cotizacion'],
  ['compra', 'compra', 'compra/compra'],
  ['venta', 'venta', 'venta/venta'],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const percentile = (values, p) =>
  values.slice().sort((a, b) => a - b)[
    Math.max(0, Math.ceil(values.length * p) - 1)
  ];
let stage = 'Inicio';
async function main() {
  assert.equal(process.versions.node.split('.')[0], '24');
  const relational = true;
  const profileArg = process.argv.find((x) => x.startsWith('--profile='));
  const profile = profileArg
    ? require('./full-app-load-profiles').selectProfile(profileArg.slice(10))
    : null;
  assert.ok(
    !process.argv.includes('--require-profile') || profile,
    'Selecciona --profile=mostrador|operaciones|soak',
  );
  assert.ok(
    !process.argv.includes('--objective-failure') || profile,
    'Fallo de objetivo requiere perfil',
  );
  const serverTransport = process.argv.includes('--server-transport');
  const transportRecorder = serverTransport
    ? require('./load-server-transport').createTransportRecorder()
    : null;
  const transportSearch =
    serverTransport || process.argv.includes('--transport-search');
  const transportProbe =
    transportSearch || process.argv.includes('--transport-probe');
  const transportFailure = process.argv.includes('--transport-failure');
  assert.ok(
    !transportFailure || transportProbe,
    'Fallo transporte requiere probe',
  );
  const separateFinancialClient = process.argv.includes(
    '--separate-financial-client',
  );
  const memoryDiagnostic =
    separateFinancialClient || process.argv.includes('--memory-diagnostic');
  assert.ok(
    !memoryDiagnostic || profile?.name === 'soak',
    '--memory-diagnostic requiere --profile=soak',
  );
  const extendedSoak = process.argv.includes('--extended-soak');
  const separatedExtended = separateFinancialClient && extendedSoak;
  const separatedPhase = transportProbe
    ? transportSearch
      ? serverTransport
        ? 'Q04.5.3c2c3d12c'
        : 'Q04.5.3c2c3d12b'
      : 'Q04.5.3c2c3d12'
    : separatedExtended
      ? 'Q04.5.3c2c3d11'
      : 'Q04.5.3c2c3d10';
  if (transportProbe)
    assert.ok(
      separateFinancialClient && !extendedSoak,
      'Probe requiere cliente separado sin extended',
    );
  const separatedStem = transportProbe
    ? transportSearch
      ? serverTransport
        ? 'q0453c2c3d12c-server'
        : 'q0453c2c3d12b-search'
      : 'q0453c2c3d12-transport'
    : separatedExtended
      ? 'q0453c2c3d11-separated-soak'
      : 'q0453c2c3d10-separated';
  const coverageFailure = process.argv.includes('--coverage-failure');
  assert.ok(
    !coverageFailure || separatedExtended,
    'Fallo de cobertura requiere soak separado',
  );
  assert.ok(
    !extendedSoak || profile?.name === 'soak',
    '--extended-soak requiere --profile=soak',
  );
  const commercialDocumentsHttp =
    memoryDiagnostic ||
    extendedSoak ||
    process.argv.includes('--commercial-documents-http');
  const documentsHttp =
    commercialDocumentsHttp || process.argv.includes('--documents-http');
  const supplierRetries =
    documentsHttp || process.argv.includes('--supplier-retry-http');
  const reversalsHttp =
    supplierRetries || process.argv.includes('--reversals-http');
  const financialHttp =
    reversalsHttp ||
    Boolean(profile) ||
    process.argv.includes('--financial-http');
  const financialHttpResults = [];
  const transactionBreakdown = process.argv.includes('--transaction-breakdown');
  const separate = true;
  assert.ok(!separate || relational, '--separate requiere --relational');
  const durationArg = process.argv.find((x) => x.startsWith('--duration='));
  const secondsPerGroup = durationArg
    ? Number(durationArg.slice(11))
    : extendedSoak
      ? 3600
      : (profile?.duration ?? 300);
  assert.ok(
    Number.isInteger(secondsPerGroup) &&
      secondsPerGroup >= 40 &&
      secondsPerGroup <= (profile ? 3600 : 600),
  );
  const volumeArg = process.argv.find((x) => x.startsWith('--fixtures='));
  const fixtureCount = volumeArg ? Number(volumeArg.slice(11)) : 20000;
  assert.ok(
    Number.isInteger(fixtureCount) &&
      fixtureCount >= 1000 &&
      fixtureCount <= 100000 &&
      fixtureCount % 1000 === 0,
  );
  const arg = process.argv.find((x) => x.startsWith('--backup='));
  assert.ok(arg, 'Falta --backup=RUTA');
  const dump = path.resolve(arg.slice(9)),
    root = path.resolve(__dirname, '../../.backups');
  assert.ok(dump.startsWith(root + path.sep) && fs.existsSync(dump));
  const base = databaseConfig(),
    admin = new Client(base),
    name = `sistema_http_${Date.now()}_${randomBytes(3).toString('hex')}`;
  assert.match(name, /^sistema_http_\d+_[a-f0-9]{6}$/);
  const options = { ...base, database: name };
  if (base.connectionString) {
    const u = new URL(base.connectionString);
    u.pathname = '/' + name;
    options.connectionString = u.toString();
  }
  let created = false,
    writer,
    ds,
    metricsClient,
    app,
    report,
    loadError,
    diagnosticGroup,
    financialClient;
  const originalLog = console.log;
  const progress = (label) => {
    stage = label;
    if (profile) originalLog(label);
  };
  progress('Conexión administrativa');
  await admin.connect();
  let transactionAgeContract;
  try {
    transactionAgeContract =
      await require('./verify-transaction-age').verifyTransactionAge(
        admin,
        name,
      );
    assert.notEqual(
      name,
      (await admin.query('SELECT current_database() name')).rows[0].name,
    );
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    created = true;
    progress('Restauración de copia aislada');
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
    progress('Comprobación y aplicación de migraciones en copia');
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
    writer = new Client(options);
    progress('Preparación de fixtures sintéticos');
    await writer.connect();
    await writer.query(
      'CREATE SCHEMA q04_load;SET search_path=q04_load,public',
    );
    await fixtures(writer, fixtureCount, true);
    await writer.query(
      'CREATE TABLE fiscal_documento(id_factura int PRIMARY KEY,estado text);CREATE TABLE auth_user (LIKE public.auth_user INCLUDING ALL);COMMIT',
    );
    progress('Preparación de proyecciones relacionales');
    if (relational)
      await require('./list-relational-fixtures').relationalFixtures(
        writer,
        name,
        fixtureCount,
      );
    progress('Preparación de usuario y almacén');
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
      entities: [AuthUser],
      extra: {
        max: 4,
        connectionTimeoutMillis: 5000,
        options: `-c search_path=${relational ? 'public' : 'q04_load,public'} -c statement_timeout=15000 -c lock_timeout=2000`,
      },
    });
    await ds.initialize();
    assert.equal(
      (await ds.query('SELECT current_database() name'))[0].name,
      name,
    );
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    process.env.ALLOW_ENV_AUTH = 'false';
    const password = randomBytes(24).toString('hex'),
      username = 'q04http' + randomBytes(4).toString('hex');
    const repository = ds.getRepository(AuthUser);
    await repository.save({
      username,
      passwordHash: await require('bcrypt').hash(password, 10),
      role: 'admin',
      isActive: true,
      tokenVersion: 0,
    });
    const AlmacenService = load('almacen/almacen.service', 'AlmacenService');
    const [home] = await ds.query(
      `SELECT u.id_ubicacion id,u.id_almacen warehouse FROM almacen_ubicacion u JOIN almacen a ON a.id_almacen=u.id_almacen WHERE a.es_principal AND u.codigo='GENERAL' LIMIT 1`,
    );
    assert.ok(home);
    const location = await new AlmacenService(ds).createLocation({
      idAlmacen: home.warehouse,
      codigo: 'Q04HTTP-' + randomUUID().slice(0, 8),
    });
    await new AlmacenService(ds).saveKit(2, {
      componentes: [{ idProducto: 3, cantidad: 2 }],
    });
    await ds.query(
      `UPDATE factura SET total=100000,subtotal=100000,saldo_pendiente=100000,estatus='Pendiente' WHERE id_factura=2`,
    );
    const [initialCash] = await ds.query(
      'SELECT caja_chica::float8 cash FROM saldos ORDER BY id_saldo LIMIT 1',
    );
    assert.ok(initialCash);
    metricsClient = new Client(options);
    await metricsClient.connect();
    const settings = (
      await metricsClient.query(
        "SELECT current_setting('server_version') version,current_setting('autovacuum') autovacuum",
      )
    ).rows[0];
    let businessPayments = 0;
    const isolatedUrl = options.connectionString
      ? new URL(options.connectionString)
      : new URL('postgresql://127.0.0.1');
    if (!options.connectionString) {
      isolatedUrl.hostname = base.host;
      isolatedUrl.port = String(base.port);
      isolatedUrl.username = base.user;
      isolatedUrl.password = base.password;
    }
    isolatedUrl.pathname = '/' + name;
    process.env.DATABASE_URL = isolatedUrl.toString();
    process.env.DB_NAME = name;
    process.env.FISCAL_MODE = 'mock';
    process.env.TEST_DATABASE_ISOLATED = 'true';
    const module = await Test.createTestingModule({
      imports: [load('app.module', 'AppModule')],
    }).compile();
    app = module.createNestApplication({ logger: false });
    if (transportRecorder) app.use(transportRecorder.middleware);
    configureApp(app);
    if (transportFailure)
      app.use('/api/v1/__q04_transport_failure', (_req, res) => {
        res.writeHead(200, { 'Content-Length': '100' });
        res.flushHeaders();
        res.write('{');
        setTimeout(() => res.destroy(), 30);
      });
    await app.init();
    await ds.destroy();
    ds = app.get(DataSource);
    assert.equal(
      (await ds.query('SELECT current_database() name'))[0].name,
      name,
    );
    for (const [table, column] of [
      ['cliente', 'IdCliente'],
      ['proveedor', 'IdProveedor'],
      ['producto', 'IdProducto'],
      ['factura', 'id_factura'],
      ['cotizacion', 'id_cotizacion'],
      ['compra', 'id_compra'],
    ])
      await ds.query(
        `SELECT setval(pg_get_serial_sequence($1,$2),(SELECT max("${column}") FROM "${table}"),true)`,
        ['public.' + table, column],
      );
    await ds.query(
      `UPDATE cliente SET "RFC"='XAXX010101000' WHERE "IdCliente"=1`,
    );
    progress('Preflight de AppModule');
    const scheduler = app.get(require('@nestjs/schedule').SchedulerRegistry);
    assert.ok(scheduler.getCronJobs().size >= 2);
    await app
      .get(load('notification/notification.service', 'NotificationService'))
      .refreshOperationalAlerts();
    let financialCycles = 0,
      financialCashAdjustment = 0;
    // Suppress structured per-request logs only in this tool process, not in the application.
    console.log = (...args) => {
      if (
        typeof args[0] === 'string' &&
        args[0].startsWith('{"type":"http_request"')
      )
        return;
      originalLog(...args);
    };
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl(),
      api = url + '/api/v1/';
    assert.equal((await localLoadFetch(api + 'cliente/pagina')).status, 401);
    const login = await localLoadFetch(api + 'auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    assert.equal(login.status, 201);
    const token = (await readLoadBody(login, 'json')).access_token;
    assert.ok(token);
    const headers = { Authorization: 'Bearer ' + token };
    assert.equal(
      (await localLoadFetch(api + 'cliente/pagina?limit=101', { headers }))
        .status,
      400,
    );
    assert.equal(
      (await localLoadFetch(api + 'venta?desde=2026-02-30', { headers }))
        .status,
      400,
    );
    for (const [, route] of domains) {
      const exportRoute = route.replace('/pagina', '') + '/exportar';
      const response = await localLoadFetch(
        api + exportRoute + '?term=Q04TARGET',
        {
          headers,
          signal: AbortSignal.timeout(5000),
        },
      );
      assert.equal(response.status, 200);
      assert.ok(response.headers.get('content-type').startsWith('text/csv'));
      assert.ok(
        response.headers.get('content-disposition').includes('attachment'),
      );
      const csv = await readLoadBody(response, 'text');
      assert.equal(csv.trim().split(/\r?\n/).length, fixtureCount / 1000 + 1);
    }
    const cases = domains.flatMap(([domain, route]) =>
      ['', 'Q04TARGET', '%', 'Q04HTTPONLY'].map((term) => ({
        domain,
        route,
        term,
      })),
    );
    const request = require('./full-app-http-contract').createRequest(
      api,
      headers,
      relational,
      fixtureCount,
    );
    for (const c of cases) await request(c);
    const limitStatuses = [];
    for (let i = 0; i < 102; i++)
      limitStatuses.push(
        (
          await localLoadFetch(api + 'health', {
            signal: AbortSignal.timeout(5000),
          })
        ).status,
      );
    assert.ok(limitStatuses.includes(429));
    assert.ok(limitStatuses.every((x) => x === 200 || x === 429));
    const groups = [];
    const { runGenerator } = require('./full-app-http-generator');
    const { databaseStats, activity } = require('./list-postgres-metrics');
    const { businessMetrics, tracker } = require('./list-business-metrics');
    for (const readers of [profile?.readers ?? 8]) {
      progress('Carga HTTP y escritores');
      if (separateFinancialClient)
        financialClient =
          await require('./full-app-financial-client').startFinancialClient({
            options,
            injectFailure: process.argv.includes('--financial-client-failure'),
            injectTransportFailure: transportFailure,
            api,
            headers,
            flags: {
              reversals: reversalsHttp,
              retries: supplierRetries,
              documents: documentsHttp,
              commercialDocuments: commercialDocumentsHttp,
              transportProbe,
            },
          });
      let financialClientMemory;
      const memorySamples = [];
      const memoryCollector = memoryDiagnostic
        ? new (require('./memory-diagnostic').MemoryDiagnostic)()
        : null;
      const delay = monitorEventLoopDelay({ resolution: 20 });
      delay.enable();
      const cpuStart = process.cpuUsage(),
        started = performance.now();
      const loadAbort = new AbortController();
      let failureContext;
      let stop = false,
        commits = 0,
        lastProgress = started,
        writerError;
      const stats = {
        rssPeak: 0,
        heapPeak: 0,
        poolConnectionsPeak: 0,
        poolWaitingPeak: 0,
      };
      const sample = () => {
        const mem = process.memoryUsage(),
          pool = ds.driver.master;
        stats.rssPeak = Math.max(stats.rssPeak, mem.rss);
        memorySamples.push(mem.rss);
        memoryCollector?.add(mem, performance.now() - started);
        if (profile && performance.now() - lastProgress >= 60000) {
          lastProgress = performance.now();
          originalLog(
            `Perfil ${profile.name}: ${Math.floor((lastProgress - started) / 1000)} s, ${commits} commits, ${financialCycles} ciclos financieros; RSS ${(mem.rss / 1048576).toFixed(1)} MiB.`,
          );
        }
        stats.heapPeak = Math.max(stats.heapPeak, mem.heapUsed);
        stats.poolConnectionsPeak = Math.max(
          stats.poolConnectionsPeak,
          pool.totalCount,
        );
        stats.poolWaitingPeak = Math.max(
          stats.poolWaitingPeak,
          pool.waitingCount,
        );
      };
      sample();
      const timer = setInterval(sample, 100),
        latencies = [],
        counts = {};
      const writeLoop = (async () => {
        try {
          while (!stop) {
            const value = commits % 2 ? 'Q04HTTPONLY' : 'QUIET';
            await writer.query('BEGIN');
            try {
              for (const sql of [
                'UPDATE cliente SET "RazonSocial"=$1 WHERE "IdCliente"=1',
                'UPDATE proveedor SET "RazonSocial"=$1 WHERE "IdProveedor"=1',
                'UPDATE producto SET "Descripcion"=$1 WHERE "IdProducto"=1',
                'UPDATE fixture_products SET "Descripcion"=$1 WHERE "IdProducto"=1',
                'UPDATE factura SET nombre_receptor=$1 WHERE id_factura=1',
                'UPDATE cotizacion SET nombre_receptor=$1 WHERE id_cotizacion=1',
                'UPDATE fixture_compras SET nombre_proveedor=$1 WHERE id_compra=1',
              ])
                if (!relational || !sql.includes('fixture_'))
                  await writer.query(sql, [value]);
              await writer.query('COMMIT');
              commits++;
            } catch (e) {
              await writer.query('ROLLBACK');
              throw e;
            }
            await sleep(profile?.sqlPauseMs ?? 30);
          }
        } catch (e) {
          writerError = e;
          failureContext ??= {
            source: 'sql-writer',
            elapsedMs: performance.now() - started,
            diagnostic: e.diagnostic ?? null,
          };
          loadAbort.abort();
        }
      })();
      const businessCounts = {
        transfers: 0,
        assembled: 0,
        disassembled: 0,
        payments: 0,
        replays: 0,
      };
      let businessError,
        financialActive = false,
        businessActive = false;
      async function post(route, dto) {
        const res = await localLoadFetch(api + route, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(dto),
          signal: AbortSignal.timeout(15000),
        });
        assert.equal(res.status, 201, route + ': HTTP ' + res.status);
        return readLoadBody(res, 'json');
      }
      const businessLoop = (async () => {
        try {
          while (!stop) {
            while (financialActive && !stop) await sleep(10);
            if (stop) break;
            businessActive = true;
            const transfer = {
              requestId: randomUUID(),
              idProducto: 3,
              idOrigen: home.id,
              idDestino: location.idUbicacion,
              cantidad: 0.25,
              motivo: 'Q04 carga HTTP',
            };
            const first = await post('almacen/transferencias', transfer);
            businessCounts.transfers++;
            if (businessCounts.transfers % 10 === 1) {
              const replay = await post('almacen/transferencias', transfer);
              assert.equal(replay.idTransferencia, first.idTransferencia);
              businessCounts.replays++;
            }
            await post('almacen/transferencias', {
              ...transfer,
              requestId: randomUUID(),
              idOrigen: location.idUbicacion,
              idDestino: home.id,
            });
            businessCounts.transfers++;
            await post('almacen/kits/2/armar', {
              requestId: randomUUID(),
              cantidad: 1,
            });
            businessCounts.assembled++;
            await post('almacen/kits/2/desarmar', {
              requestId: randomUUID(),
              cantidad: 1,
            });
            businessCounts.disassembled++;
            const payment = {
              requestId: randomUUID(),
              idFactura: 2,
              monto: 0.01,
              formaPago: 'Efectivo',
              referencia: 'Q04HTTP-real',
              notas: '',
            };
            const saved = await post('pago', payment);
            businessCounts.payments++;
            businessPayments++;
            if (businessCounts.payments % 10 === 1) {
              const replay = await post('pago', payment);
              assert.equal(replay.idPago, saved.idPago);
              businessCounts.replays++;
            }
            businessActive = false;
            await sleep(profile?.businessPauseMs ?? 2000);
          }
        } catch (e) {
          businessActive = false;
          businessError ??= e;
          failureContext ??= {
            source: 'warehouse-payment-client',
            elapsedMs: performance.now() - started,
            diagnostic: e.diagnostic ?? null,
          };
          originalLog('Fallo de carga: ' + e.message);
          loadAbort.abort();
        }
      })();
      const financialLoop = (async () => {
        try {
          while (!stop) {
            financialActive = true;
            while (businessActive && !stop) await sleep(10);
            if (stop) {
              financialActive = false;
              break;
            }
            const [before] = await ds.query(
              'SELECT caja_chica::float8 cash,(SELECT coalesce(sum(monto),0)::float8 FROM pago WHERE id_factura=2) fixture FROM saldos ORDER BY id_saldo LIMIT 1',
            );
            // Pause the single HTTP writer during this batch to isolate its cash delta.
            if (financialHttp)
              financialHttpResults.push(
                financialClient
                  ? await financialClient.run()
                  : await require('./full-app-financial-http').verifyFinancialHttp(
                      ds,
                      api,
                      headers,
                      {
                        reversals: reversalsHttp,
                        retries: supplierRetries,
                        documents: documentsHttp,
                        commercialDocuments: commercialDocumentsHttp,
                        transportProbe,
                      },
                    ),
              );
            else
              await require('./verify-operaciones-2026-09-16').verifyOperations(
                ds,
                { financialOnly: true },
              );
            const [after] = await ds.query(
              'SELECT caja_chica::float8 cash,(SELECT coalesce(sum(monto),0)::float8 FROM pago WHERE id_factura=2) fixture FROM saldos ORDER BY id_saldo LIMIT 1',
            );
            financialCashAdjustment +=
              after.cash - before.cash - (after.fixture - before.fixture);
            financialCycles++;
            financialActive = false;
            for (
              let i = 0;
              i < (profile?.financialPauseMs ?? 20000) / 100 && !stop;
              i++
            )
              await sleep(100);
          }
        } catch (e) {
          financialActive = false;
          businessError ??= e;
          failureContext ??= {
            source: 'financial-document-client',
            elapsedMs: performance.now() - started,
            diagnostic: e.diagnostic ?? null,
          };
          originalLog('Fallo de carga: ' + e.message);
          loadAbort.abort();
        }
      })();
      const tracked = tracker(),
        resourceBefore = await businessMetrics(metricsClient, name);
      tracked.add(resourceBefore);
      const resourceLoop = (async () => {
        try {
          while (!stop) {
            await sleep(5000);
            if (!stop) tracked.add(await businessMetrics(metricsClient, name));
          }
        } catch (e) {
          businessError ??= e;
          failureContext ??= {
            source: 'postgres-resource-monitor',
            elapsedMs: performance.now() - started,
            diagnostic: e.diagnostic ?? null,
          };
          originalLog('Fallo de carga: ' + e.message);
          loadAbort.abort();
        }
      })();
      let results, generatorStats, generatorError, readWindows;
      const pgBefore = separate ? await databaseStats(admin, name) : undefined;
      const pgPeak = {
        samples: 0,
        connections: 0,
        active: 0,
        waiting: 0,
        maxTransactionAgeSeconds: 0,
        clientConnections: 0,
        auxiliaryConnections: 0,
        maxClientTransactionAgeSeconds: 0,
        maxAuxiliaryTransactionAgeSeconds: 0,
        maxAutovacuumTransactionAgeSeconds: 0,
      };
      let monitorError;
      const pgLoop = (async () => {
        if (!separate) return;
        try {
          while (!stop) {
            const sample = await activity(admin, name);
            pgPeak.samples++;
            for (const key of Object.keys(sample))
              pgPeak[key] = Math.max(pgPeak[key] ?? 0, sample[key]);
            await sleep(500);
          }
        } catch (e) {
          monitorError = e;
        }
      })();
      try {
        if (separate) {
          const generated = await runGenerator(
            {
              api,
              fixtureCount,
              token,
              relational,
              readers,
              secondsPerGroup,
              readerPauseMs: profile?.readerPauseMs ?? 1500,
              cases,
              fail: process.argv.includes('--generator-failure'),
            },
            loadAbort.signal,
          );
          latencies.push(...generated.latencies);
          Object.assign(counts, generated.counts);
          generatorStats = generated.resources;
          readWindows = generated.windows;
          results = [];
        } else
          results = await Promise.allSettled(
            Array.from({ length: readers }, (_, reader) =>
              (async () => {
                let i = reader;
                while (performance.now() - started < secondsPerGroup * 1000) {
                  const c = cases[i++ % cases.length];
                  latencies.push(await request(c));
                  const key = c.domain + ':' + c.term;
                  counts[key] = (counts[key] || 0) + 1;
                }
              })(),
            ),
          );
      } catch (e) {
        generatorError = e;
        failureContext ??= {
          source: 'reader-generator',
          elapsedMs: performance.now() - started,
          diagnostic: e.diagnostic ?? null,
        };
      } finally {
        stop = true;
        await writeLoop;
        await businessLoop;
        await financialLoop;
        if (financialClient) {
          financialClientMemory = await financialClient.close();
          financialClient = null;
        }
        await pgLoop;
        await resourceLoop;
        clearInterval(timer);
        sample();
        delay.disable();
      }
      if (memoryCollector)
        diagnosticGroup = {
          elapsedMs: performance.now() - started,
          requests: latencies.length,
          writerCommits: commits,
          financialCycles,
          business: businessCounts,
          memoryDiagnostic: memoryCollector.result(),
          financialClientMemory,
          readWindows,
          errors: 1,
          incomplete: true,
          failureContext,
          serverTransport: transportRecorder?.result(),
          readerResultAvailable: Boolean(generatorStats),
          failure: (
            writerError ??
            businessError ??
            generatorError ??
            monitorError
          )?.message,
        };
      if (diagnosticGroup && separateFinancialClient)
        diagnosticGroup.memoryDiagnostic.scope =
          'Padre: AppModule, monitor, escritor SQL y cliente de almacen/pagos; lectores y cliente financiero/documental separados.';
      if (writerError) throw writerError;
      if (businessError) throw businessError;
      if (generatorError) throw generatorError;
      if (monitorError) throw monitorError;
      const pgAfter = separate ? await databaseStats(admin, name) : undefined;
      const pgDelta = separate
        ? Object.fromEntries(
            Object.keys(pgBefore).map((key) => [
              key,
              pgAfter[key] - pgBefore[key],
            ]),
          )
        : undefined;
      if (separate) assert.equal(pgDelta.deadlocks, 0);
      for (const result of results)
        if (result.status === 'rejected') throw result.reason;
      assert.ok(commits > 0);
      assert.equal(Object.keys(counts).length, 24);
      assert.ok(stats.poolConnectionsPeak <= 10);
      const elapsedMs = performance.now() - started,
        cpu = process.cpuUsage(cpuStart);
      const idle = (
        await writer.query(
          "SELECT count(*)::int total FROM pg_stat_activity WHERE datname=current_database() AND state LIKE 'idle in transaction%'",
        )
      ).rows[0].total;
      assert.equal(idle, 0);
      const resourceAfter = await businessMetrics(metricsClient, name);
      tracked.add(resourceAfter);
      const walBytes = Number(
        (
          await metricsClient.query(
            'SELECT pg_wal_lsn_diff($1::pg_lsn,$2::pg_lsn)::float8 bytes',
            [resourceAfter.wal, resourceBefore.wal],
          )
        ).rows[0].bytes,
      );
      const stock = await ds.query(
        `SELECT p."IdProducto" id,p."Existencia"::float8 stock,(SELECT coalesce(sum(cantidad),0) FROM inventario_ubicacion WHERE id_producto=p."IdProducto")::float8 physical FROM producto p WHERE p."IdProducto" IN (2,3)`,
      );
      for (const row of stock) {
        assert.equal(row.stock, 10);
        assert.equal(row.stock, row.physical);
      }
      const financial = (
        await ds.query(
          `SELECT (SELECT saldo_pendiente FROM factura WHERE id_factura=2)::float8 balance,(SELECT count(*) FROM pago WHERE id_factura=2)::int payments,(SELECT coalesce(sum(monto),0) FROM pago WHERE id_factura=2)::float8 amount,(SELECT caja_chica FROM saldos ORDER BY id_saldo LIMIT 1)::float8 cash`,
        )
      )[0];
      assert.equal(financial.payments, businessPayments);
      assert.equal(Math.round(financial.amount * 100), businessPayments);
      assert.equal(
        Math.round(financial.balance * 100),
        10000000 - businessPayments,
      );
      assert.equal(
        Math.round(
          (financial.cash - initialCash.cash - financialCashAdjustment) * 100,
        ),
        businessPayments,
      );
      assert.equal(businessCounts.assembled, businessCounts.disassembled);
      groups.push({
        ...(separateFinancialClient
          ? {
              financialClientMemory,
              processScope:
                'Padre: AppModule, monitor, escritor SQL y cliente HTTP de almacén/pagos; cliente financiero/documental y lectores separados. No es servidor puro.',
            }
          : {}),
        business: businessCounts,
        financialCycles,
        businessIntegrity: {
          stockPhysicalAligned: true,
          stockRestored: true,
          paymentBalanceCashAligned: true,
        },
        postgresProcesses: tracked.result,
        walBytesClusterWide: walBytes,
        readers,
        generatorResources: generatorStats,
        readWindows,
        postgres: separate
          ? { peak: pgPeak, countersDelta: pgDelta }
          : undefined,
        requests: latencies.length,
        writerCommits: commits,
        elapsedMs,
        rps: (latencies.length * 1000) / elapsedMs,
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        max: latencies.reduce((max, value) => Math.max(max, value), 0),
        ...stats,
        ...(memoryCollector
          ? { memoryDiagnostic: memoryCollector.result() }
          : {}),
        cpuMicroseconds: cpu,
        eventLoopP95Ms: delay.percentile(95) / 1e6,
        eventLoopMaxMs: delay.max / 1e6,
        idleTransactions: idle,
        cases: counts,
        serverTransport: transportRecorder?.result(),
        errors: 0,
      });
      if (separateFinancialClient)
        groups.at(-1).memoryDiagnostic.scope = groups.at(-1).processScope;
      if (memoryDiagnostic) diagnosticGroup = groups.at(-1);
      if (separatedExtended) {
        if (coverageFailure)
          financialClientMemory.windows = financialClientMemory.windows.filter(
            (window) => window.minute !== 0,
          );
        const { evaluateMemoryCoverage } = require('./separated-soak-coverage');
        const coverage = {
          parent: evaluateMemoryCoverage(
            groups.at(-1).memoryDiagnostic,
            secondsPerGroup,
          ),
          financialClient: evaluateMemoryCoverage(
            financialClientMemory,
            secondsPerGroup,
          ),
        };
        groups.at(-1).processMemoryCoverage = coverage;
        assert.ok(
          coverage.parent.passed && coverage.financialClient.passed,
          'Cobertura de memoria por proceso incompleta',
        );
      }
      if (extendedSoak) {
        const stability = require('./full-app-load-profiles').evaluateExtended(
          groups.at(-1),
          secondsPerGroup,
        );
        groups.at(-1).stability = stability;
        assert.ok(
          stability.passed,
          'Cobertura temporal soak incompleta o p95 por minuto incumplido',
        );
      }
      if (profile) {
        // Deliberate regression failure to verify cleanup/report preservation.
        if (process.argv.includes('--objective-failure'))
          groups.at(-1).p95 = 501;
        const assessment = require('./full-app-load-profiles').evaluate(
          groups.at(-1),
          memorySamples,
        );
        groups.at(-1).objectives = assessment;
        assert.ok(
          assessment.passed,
          'Objetivos locales incumplidos: ' +
            Object.entries(assessment.checks)
              .filter(([, passed]) => !passed)
              .map(([key]) => key)
              .join(', '),
        );
      }
      originalLog(
        `Grupo ${readers}: ${latencies.length} HTTP, ${commits} commits; p95 ${groups.at(-1).p95.toFixed(2)} ms.`,
      );
    }
    report = {
      generatedAt: new Date().toISOString(),
      postgresSettings: settings,
      profile,
      phase: separateFinancialClient
        ? separatedPhase
        : memoryDiagnostic
          ? 'Q04.5.3c2c3d9'
          : extendedSoak
            ? 'Q04.5.3c2c3d8'
            : commercialDocumentsHttp
              ? 'Q04.5.3c2c3d7'
              : documentsHttp
                ? 'Q04.5.3c2c3d6'
                : supplierRetries
                  ? 'Q04.5.3c2c3d5'
                  : reversalsHttp
                    ? 'Q04.5.3c2c3d4'
                    : profile
                      ? 'Q04.5.3c2c3d3'
                      : financialHttp
                        ? 'Q04.5.3c2c3d2'
                        : transactionBreakdown
                          ? 'Q04.5.3c2c3d1'
                          : 'Q04.5.3c2c3c',
      financialHttpResults,
      transactionAgeScope: {
        client:
          'client backend: aplicación, escritor SQL y conexiones de medición; no exclusivamente HTTP',
        auxiliary:
          'backend_type distinto de client backend; incluye autovacuum',
        autovacuum: 'autovacuum worker; subconjunto de auxiliares',
        peaks:
          'Máximos independientes muestreados cada 500 ms; no se suman ni equivalen a duración de solicitudes',
      },
      transactionAgeContract,
      node: process.versions.node,
      fixturesPerDomain: fixtureCount,
      poolMax: 10,
      secondsPerGroup,
      relational,
      separateGenerator: separate,
      schedulerJobs: scheduler.getCronJobs().size,
      preflight: {
        throttler429: true,
        notificationJobExecuted: true,
        unauthorized401: true,
        invalidLimit400: true,
        invalidDate400: true,
        csvSixDomains: true,
      },
      groups,
      limitations: [
        ...(extendedSoak
          ? [
              'Ventana soak local prolongada; objetivos provisionales sin relajar. Una hora no certifica operación de varios días, recuperación física ni distribución/SLA productivos.',
            ]
          : []),
        ...(documentsHttp
          ? [
              'Documentos proveedor por HTTP: XML de prueba ingresado por JSON y PDF multipart, hashes/bytes/MIME/disposición y rechazos. PDF mínimo sintético: no certifica renderizado, estructura completa, antivirus ni autenticidad fiscal del XML.',
            ]
          : []),
        supplierRetries
          ? 'Ocho solicitudes concurrentes por operación de proveedor; UUID mayúscula, contenido/operación distinta 409 y rollback tras efectos financieros. Registros anteriores sin huella se rechazan. No prueba caída física ni todas las carreras entre operaciones con claves distintas.'
          : reversalsHttp
            ? 'Recorridos financieros HTTP ampliados con NC/devoluciones/cancelación y cuentas proveedor; fiscal mock. No certifica carreras ni rechazo de contenido distinto con UUID de proveedor.'
            : financialHttp
              ? 'AppModule completo; compra/venta PPD/REP/pedido facturado/orden y recepción por HTTP, fiscal mock. No sustituye regresión integral de NC, reversos ni cuentas proveedor.'
              : 'AppModule completo con JWT/permisos/scheduler/ThrottlerGuard; fiscal mock. Flujos financieros usan servicios reales sobre DataSource de aplicación, no todos por HTTP.',
        relational
          ? 'Seis proyecciones reales; transferencias/kits/cobros por HTTP y mutación SQL de nombres para carreras total/página. Modalidad financiera indicada por financialHttpResults; escritores de caja coordinados. Imágenes como metadatos, no archivos.'
          : 'Productos/compras usan proyección sintética; escrituras SQL sintéticas, no flujos financieros del negocio.',
        `Carga cerrada, caché caliente y ventanas de ${secondsPerGroup} segundos y ${fixtureCount} registros por dominio: no certificación de capacidad máxima, SLA ni soak de horas.`,
        separateFinancialClient
          ? 'Cliente financiero/documental y lectores separados; padre incluye servidor, monitor, escritor SQL y cliente de almacen/pagos. Una conexion PG adicional del cliente; pool de aplicacion sin ajuste, maximo 10. No es servidor puro. No sumar picos independientes ni inferir causalidad entre ventanas.'
          : 'Padre incluye servidor, monitor y escritores; lectores separados. PostgreSQL muestreado mediante CIM; working sets incluyen paginas compartidas, I/O incluye red y WAL corresponde al cluster completo. Pool de aplicacion sin ajuste, maximo 10.',
      ],
    };
  } catch (error) {
    loadError = error;
  } finally {
    console.log = originalLog;
    try {
      if (financialClient) await financialClient.close();
    } finally {
      try {
        if (app) await app.close();
      } finally {
        try {
          if (ds?.isInitialized) await ds.destroy();
        } finally {
          try {
            try {
              if (writer) await writer.end();
            } finally {
              if (metricsClient) await metricsClient.end();
            }
          } finally {
            try {
              if (created) {
                assert.match(name, /^sistema_http_\d+_[a-f0-9]{6}$/);
                await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
              }
            } finally {
              await admin.end();
            }
          }
        }
      }
    }
  }
  if (loadError) {
    if (memoryDiagnostic && diagnosticGroup) {
      const diagnosticStem = separateFinancialClient
        ? separatedStem
        : 'q0453c2c3d9-memory-diagnostic';
      const failureKind = transportFailure
        ? 'transport'
        : coverageFailure
          ? 'coverage'
          : process.argv.includes('--objective-failure')
            ? 'objective'
            : process.argv.includes('--financial-client-failure')
              ? 'client'
              : process.argv.includes('--generator-failure')
                ? 'generator'
                : null;
      fs.writeFileSync(
        path.join(
          __dirname,
          `../../docs/${diagnosticStem}${failureKind ? '-' + failureKind : ''}-failed.json`,
        ),
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            phase: separateFinancialClient ? separatedPhase : 'Q04.5.3c2c3d9',
            status: 'failed',
            injectedTransportFailure: transportFailure,
            injectedGeneratorFailure: process.argv.includes(
              '--generator-failure',
            ),
            injectedFinancialClientFailure: process.argv.includes(
              '--financial-client-failure',
            ),
            failure: loadError.message,
            injectedCoverageFailure: coverageFailure,
            injectedObjectiveFailure: process.argv.includes(
              '--objective-failure',
            ),
            secondsPerGroup,
            fixtureCount,
            profile,
            groups: [diagnosticGroup],
            scope:
              'Diagnóstico fallido publicado después de eliminar la copia; no reemplaza evidencia exitosa ni certifica rendimiento',
          },
          null,
          2,
        ) + '\n',
      );
    }
    throw loadError;
  }
  fs.writeFileSync(
    path.join(
      __dirname,
      separateFinancialClient
        ? `../../docs/${separatedStem}.json`
        : memoryDiagnostic
          ? '../../docs/q0453c2c3d9-memory-diagnostic.json'
          : extendedSoak
            ? '../../docs/q0453c2c3d8-extended-soak.json'
            : commercialDocumentsHttp
              ? '../../docs/q0453c2c3d7-commercial-documents.json'
              : documentsHttp
                ? '../../docs/q0453c2c3d6-documents-http.json'
                : supplierRetries
                  ? '../../docs/q0453c2c3d5-supplier-retry.json'
                  : reversalsHttp
                    ? '../../docs/q0453c2c3d4-reversals-http.json'
                    : profile
                      ? `../../docs/q0453c2c3d3-${profile.name}.json`
                      : financialHttp
                        ? '../../docs/q0453c2c3d2-financial-http.json'
                        : transactionBreakdown
                          ? '../../docs/q0453c2c3d1-transaction-age.json'
                          : '../../docs/q0453c2c3c-full-app.json',
    ),
    JSON.stringify(report, null, 2) + '\n',
  );
  originalLog('Carga HTTP validada; base aislada eliminada.');
}
main().catch((e) => {
  console.error(stage + ': ' + e.message);
  process.exitCode = 1;
});
