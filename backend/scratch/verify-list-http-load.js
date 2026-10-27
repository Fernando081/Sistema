/* Q04.5.3c1: bounded HTTP load against an owned, restored database. */
require('reflect-metadata');
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { randomBytes } = require('node:crypto'),
  { execFileSync } = require('node:child_process');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { Client } = require('pg'),
  { DataSource } = require('typeorm'),
  { Test } = require('@nestjs/testing'),
  { Reflector } = require('@nestjs/core');
const { databaseConfig } = require('../db-config'),
  { findPgTool, postgresEnvironment } = require('../backup'),
  { fixtures } = require('./benchmark-lists');
const load = (file, name) => require('../dist/' + file)[name];
const { PRODUCT_SOURCE } = require('../dist/producto/producto.service'),
  { COMPRA_SOURCE } = require('../dist/compra/compra-query');
const AuthUser = load('auth/auth-user.entity', 'AuthUser'),
  AuthService = load('auth/auth.service', 'AuthService'),
  JwtAuthGuard = load('auth/jwt-auth.guard', 'JwtAuthGuard');
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
async function main() {
  assert.equal(process.versions.node.split('.')[0], '24');
  const relational = process.argv.includes('--relational');
  const separate = process.argv.includes('--separate');
  assert.ok(!separate || relational, '--separate requiere --relational');
  const secondsPerGroup = relational ? 30 : 15;
  const fixtureCount = separate ? 2000 : 20000;
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
    app,
    report;
  const originalLog = console.log;
  await admin.connect();
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
    writer = new Client(options);
    await writer.connect();
    await writer.query(
      'CREATE SCHEMA q04_load;SET search_path=q04_load,public',
    );
    await fixtures(writer, fixtureCount, true);
    await writer.query(
      'CREATE TABLE fiscal_documento(id_factura int PRIMARY KEY,estado text);CREATE TABLE auth_user (LIKE public.auth_user INCLUDING ALL);COMMIT',
    );
    if (relational)
      await require('./list-relational-fixtures').relationalFixtures(
        writer,
        name,
        fixtureCount,
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
    function adapter(manager, transactional = true) {
      const source = {
        query: (sql, params) =>
          manager.query(
            relational
              ? sql
              : sql
                  .replace(
                    PRODUCT_SOURCE,
                    '(SELECT * FROM q04_load.fixture_products)',
                  )
                  .replace(
                    COMPRA_SOURCE,
                    '(SELECT * FROM q04_load.fixture_compras)',
                  ),
            params,
          ),
      };
      if (transactional)
        source.transaction = (isolation, work) =>
          ds.transaction(isolation, (m) => work(adapter(m, false)));
      return source;
    }
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
    const auth = new AuthService(repository),
      guard = new JwtAuthGuard(new Reflector(), auth),
      source = adapter(ds.manager);
    const controllers = [load('auth/auth.controller', 'AuthController')],
      providers = [
        { provide: AuthService, useValue: auth },
        { provide: JwtAuthGuard, useValue: guard },
      ];
    for (const [domain, , file] of domains) {
      const className = domain[0].toUpperCase() + domain.slice(1);
      const service = load(file + '.service', className + 'Service');
      const instance =
        domain === 'venta'
          ? new service(
              undefined,
              new (load(
                'venta/consultas-venta.service',
                'ConsultasVentaService',
              ))(source),
              undefined,
              undefined,
              undefined,
            )
          : new service(source);
      providers.push({ provide: service, useValue: instance });
      controllers.push(load(file + '.controller', className + 'Controller'));
    }
    const module = await Test.createTestingModule({
      controllers,
      providers,
    }).compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    app.useGlobalGuards(
      guard,
      new (load('auth/roles.guard', 'RolesGuard'))(new Reflector()),
      new (load('auth/permissions.guard', 'PermissionsGuard'))(
        new Reflector(),
        ds,
      ),
    );
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
    assert.equal((await fetch(api + 'cliente/pagina')).status, 401);
    const login = await fetch(api + 'auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    assert.equal(login.status, 201);
    const token = (await login.json()).access_token;
    assert.ok(token);
    const headers = { Authorization: 'Bearer ' + token };
    assert.equal(
      (await fetch(api + 'cliente/pagina?limit=101', { headers })).status,
      400,
    );
    assert.equal(
      (await fetch(api + 'venta?desde=2026-02-30', { headers })).status,
      400,
    );
    for (const [, route] of domains) {
      const exportRoute = route.replace('/pagina', '') + '/exportar';
      const response = await fetch(api + exportRoute + '?term=Q04TARGET', {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(response.status, 200);
      assert.ok(response.headers.get('content-type').startsWith('text/csv'));
      assert.ok(
        response.headers.get('content-disposition').includes('attachment'),
      );
      const csv = await response.text();
      assert.equal(csv.trim().split(/\r?\n/).length, fixtureCount / 1000 + 1);
    }
    const cases = domains.flatMap(([domain, route]) =>
      ['', 'Q04TARGET', '%', 'Q04HTTPONLY'].map((term) => ({
        domain,
        route,
        term,
      })),
    );
    const request = require('./list-http-contract').createRequest(
      api,
      headers,
      relational,
      fixtureCount,
    );
    for (const c of cases) await request(c);
    const groups = [];
    const { runGenerator } = require('./list-http-generator');
    const { databaseStats, activity } = require('./list-postgres-metrics');
    for (const readers of [1, 4, 8]) {
      const delay = monitorEventLoopDelay({ resolution: 20 });
      delay.enable();
      const cpuStart = process.cpuUsage(),
        started = performance.now();
      let stop = false,
        commits = 0,
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
            await sleep(30);
          }
        } catch (e) {
          writerError = e;
        }
      })();
      let results, generatorStats;
      const pgBefore = separate ? await databaseStats(admin, name) : undefined;
      const pgPeak = {
        samples: 0,
        connections: 0,
        active: 0,
        waiting: 0,
        maxTransactionAgeSeconds: 0,
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
          const generated = await runGenerator({
            api,
            fixtureCount,
            token,
            relational,
            readers,
            secondsPerGroup,
            cases,
            fail: process.argv.includes('--generator-failure'),
          });
          latencies.push(...generated.latencies);
          Object.assign(counts, generated.counts);
          generatorStats = generated.resources;
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
      } finally {
        stop = true;
        await writeLoop;
        await pgLoop;
        clearInterval(timer);
        sample();
        delay.disable();
      }
      if (writerError) throw writerError;
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
      assert.ok(stats.poolConnectionsPeak <= 4);
      const elapsedMs = performance.now() - started,
        cpu = process.cpuUsage(cpuStart);
      const idle = (
        await writer.query(
          "SELECT count(*)::int total FROM pg_stat_activity WHERE datname=current_database() AND state LIKE 'idle in transaction%'",
        )
      ).rows[0].total;
      assert.equal(idle, 0);
      groups.push({
        readers,
        generatorResources: generatorStats,
        postgres: separate
          ? { peak: pgPeak, countersDelta: pgDelta }
          : undefined,
        requests: latencies.length,
        writerCommits: commits,
        elapsedMs,
        rps: (latencies.length * 1000) / elapsedMs,
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        max: Math.max(...latencies),
        ...stats,
        cpuMicroseconds: cpu,
        eventLoopP95Ms: delay.percentile(95) / 1e6,
        eventLoopMaxMs: delay.max / 1e6,
        idleTransactions: idle,
        cases: counts,
        errors: 0,
      });
      originalLog(
        `Grupo ${readers}: ${latencies.length} HTTP, ${commits} commits; p95 ${groups.at(-1).p95.toFixed(2)} ms.`,
      );
    }
    report = {
      generatedAt: new Date().toISOString(),
      node: process.versions.node,
      fixturesPerDomain: fixtureCount,
      poolMax: 4,
      secondsPerGroup,
      relational,
      separateGenerator: separate,
      preflight: {
        unauthorized401: true,
        invalidLimit400: true,
        invalidDate400: true,
        csvSixDomains: true,
      },
      groups,
      limitations: [
        'Servidor Nest de prueba con controladores/servicios reales y JWT; no AppModule, scheduler, integraciones ni ThrottlerGuard.',
        relational
          ? 'Proyecciones reales y restricciones restauradas; nombres/descripciones por SQL, no flujos financieros; imágenes verificadas como metadatos, no archivos.'
          : 'Productos/compras usan proyección sintética; escrituras SQL sintéticas, no flujos financieros del negocio.',
        `Carga cerrada, caché caliente y ventanas de ${secondsPerGroup} segundos: no certificación de capacidad máxima, SLA ni soak prolongado.`,
        separate
          ? 'CPU/memoria/event loop del padre incluyen servidor, escritor y monitor; generador en hijo separado. PostgreSQL: contadores/actividad, no CPU/RSS del SO; estadísticas acumuladas pueden retrasarse. Pool 4 solo de prueba.'
          : 'CPU/memoria/event loop incluyen servidor y generador HTTP en el mismo proceso; no recursos de PostgreSQL. Pool máximo 4 solo en herramienta.',
      ],
    };
  } finally {
    console.log = originalLog;
    if (app) await app.close();
    if (ds?.isInitialized) await ds.destroy();
    if (writer) await writer.end();
    if (created) {
      assert.match(name, /^sistema_http_\d+_[a-f0-9]{6}$/);
      await admin.query(`DROP DATABASE "${name}"`);
    }
    await admin.end();
  }
  fs.writeFileSync(
    path.join(
      __dirname,
      separate
        ? '../../docs/q0453c2b-http-separated.json'
        : relational
          ? '../../docs/q0453c2a-http-relational.json'
          : '../../docs/q0453c1-http-load.json',
    ),
    JSON.stringify(report, null, 2) + '\n',
  );
  originalLog('Carga HTTP validada; base aislada eliminada.');
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
