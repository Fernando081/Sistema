/* H02-g: permisos H01/H02 con AppModule + PostgreSQL restaurado en copia desechable, sin API simulada. */
require('reflect-metadata');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto'), { execFileSync } = require('node:child_process');
const { Client } = require('pg'), { Test } = require('@nestjs/testing'), { DataSource } = require('typeorm');
const { SchedulerRegistry } = require('@nestjs/schedule');
const { databaseConfig } = require('./db-config'), { findPgTool, postgresEnvironment } = require('./backup');

// Rutas que antes aceptaban cualquier sesión. Con cuerpo vacío: guard aprobado => 400 de validación,
// guard rechazado => 403. Así se prueba la autorización sin crear ventas, cobros ni movimientos.
const ROUTES = [
  ['POST', 'compra', 'compras.recibir'],
  ['POST', 'pedidos/2147483000/surtir', 'pedidos.surtir'],
  ['POST', 'pedidos/2147483000/facturar', 'ventas.crear'],
  ['POST', 'pago', 'cobranza.registrar'],
  ['POST', 'pago/rep', 'cobranza.registrar'],
  ['POST', 'cotizacion/2147483000/convertir', 'ventas.crear'],
  ['POST', 'almacen/lotes', 'inventario.trazabilidad'],
  ['POST', 'almacen/series', 'inventario.trazabilidad'],
  ['POST', 'almacen/cascos', 'inventario.trazabilidad'],
  ['PATCH', 'almacen/cascos/2147483000', 'inventario.trazabilidad'],
];
const DENIED = [...new Set([...ROUTES.map(route => route[2]), 'pedidos.cancelar', 'compras.pagar'])];

async function main() {
  assert.equal(process.versions.node.split('.')[0], '24');
  const root = path.resolve(__dirname, '..'), argument = process.argv.find(value => value.startsWith('--backup='));
  assert.ok(argument, 'Falta --backup=RUTA bajo .backups');
  const dump = fs.realpathSync(path.resolve(argument.slice(9))), backupRoot = fs.realpathSync(path.join(root, '.backups'));
  assert.ok(dump.startsWith(backupRoot + path.sep) && fs.statSync(dump).isFile());
  const config = databaseConfig();
  assert.ok(['localhost', '127.0.0.1', '::1', '[::1]'].includes(config.connectionString ? new URL(config.connectionString).hostname : config.host));
  const admin = new Client(config), database = 'verify_routes_' + randomBytes(8).toString('hex');
  const url = new URL(config.connectionString || 'postgresql://127.0.0.1');
  if (!config.connectionString) Object.assign(url, { hostname: config.host, port: String(config.port), username: config.user, password: config.password });
  url.pathname = '/' + database;
  const envKeys = ['DATABASE_URL', 'DB_NAME', 'NODE_ENV', 'JWT_SECRET', 'ALLOW_ENV_AUTH', 'FISCAL_MODE', 'WEB_LEAD_BRIDGE_ENABLED', 'WEB_INBOX_PURGE_ENABLED'];
  const saved = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  let created = false, writer, app, stage = 'restore';
  const report = { phase: 'H02-g', startedAt: new Date().toISOString(), checks: [], isolatedDatabase: true, apiMocked: false };
  const checked = name => { report.checks.push(name); console.log('OK:', name); };
  await admin.connect();
  try {
    assert.notEqual((await admin.query('SELECT current_database() name')).rows[0].name, database);
    await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`); created = true;
    const child = { env: { ...postgresEnvironment(), DATABASE_URL: url.toString(), DB_NAME: database, PGDATABASE: database }, windowsHide: true, stdio: 'pipe', timeout: 180000, cwd: __dirname };
    execFileSync(findPgTool('pg_restore'), ['--exit-on-error', '--no-owner', '--no-acl', '--dbname', database, dump], child);
    execFileSync(process.execPath, [path.join(__dirname, 'run-migrations.js'), '--check'], child);
    execFileSync(process.execPath, [path.join(__dirname, 'run-migrations.js')], child);
    writer = new Client({ connectionString: url.toString() }); await writer.connect();
    assert.equal((await writer.query('SELECT current_database() name')).rows[0].name, database);
    const grants = (await writer.query(`SELECT role, permission_code FROM app_role_permission
      WHERE permission_code = ANY($1) ORDER BY 1, 2`, [['pedidos.surtir', 'pedidos.cancelar', 'cobranza.registrar', 'inventario.trazabilidad']])).rows;
    assert.equal(grants.length, 8, 'migraciones 114/115 deben conceder los cuatro permisos a admin y user');
    checked('Respaldo restaurado y 114/115 presentes en la copia; permisos nuevos concedidos a admin y user');

    await writer.query('UPDATE auth_user SET is_active=false');
    const password = randomBytes(24).toString('hex'), { AuthService } = require('./dist/auth/auth.service');
    const hash = await AuthService.hashPassword(password), users = {};
    for (const [name, role] of [['admin', 'admin'], ['adminDenied', 'admin'], ['operator', 'user'], ['denied', 'user']]) {
      const username = 'routes_' + name + '_' + randomBytes(4).toString('hex');
      const row = (await writer.query(`INSERT INTO auth_user(username,password_hash,role,is_active,token_version)
        VALUES($1,$2,$3,true,0) RETURNING id_user`, [username, hash, role])).rows[0];
      users[name] = { username, id: row.id_user, client: `192.168.77.${Object.keys(users).length + 10}` };
    }
    for (const code of DENIED)
      await writer.query('INSERT INTO app_user_permission(id_user,permission_code,granted) VALUES($1,$2,false)', [users.denied.id, code]);
    await writer.query("INSERT INTO app_user_permission(id_user,permission_code,granted) VALUES($1,'compras.pagar',false)", [users.adminDenied.id]);

    Object.assign(process.env, { DATABASE_URL: url.toString(), DB_NAME: database, NODE_ENV: 'test', JWT_SECRET: randomBytes(32).toString('hex'),
      ALLOW_ENV_AUTH: 'false', FISCAL_MODE: 'mock', WEB_LEAD_BRIDGE_ENABLED: 'false', WEB_INBOX_PURGE_ENABLED: 'false' });
    stage = 'AppModule';
    const module = await Test.createTestingModule({ imports: [require('./dist/app.module').AppModule] }).compile();
    app = module.createNestApplication({ logger: false }); require('./dist/configure-app').configureApp(app); await app.init();
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) job.stop();
    assert.equal((await app.get(DataSource).query('SELECT current_database() name'))[0].name, database);
    await app.listen(0, '127.0.0.1'); const api = await app.getUrl();
    const call = async (route, user, method = 'GET', body) => {
      const response = await fetch(api + '/api/v1/' + route, { method, headers: { 'X-Forwarded-For': user.client,
        ...(user.token ? { Authorization: 'Bearer ' + user.token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    };
    for (const user of Object.values(users)) {
      const login = await call('auth/login', user, 'POST', { username: user.username, password });
      assert.equal(login.status, 201, `login ${user.username}`); user.token = login.body.access_token;
    }
    checked('Cuatro cuentas propias con login real por HTTP (admin, admin sin compras.pagar, user, user con negaciones individuales)');

    stage = 'permisos';
    for (const [method, route, permission] of ROUTES) {
      for (const name of ['admin', 'operator']) {
        const result = await call(route, users[name], method, {});
        assert.equal(result.status, 400, `${name} ${method} ${route} debe pasar el guard (400 de validación), obtuvo ${result.status}`);
      }
      const denied = await call(route, users.denied, method, {});
      assert.equal(denied.status, 403, `${method} ${route} sin ${permission}: ${denied.status}`);
      assert.match(String(denied.body?.message), new RegExp(permission.replace('.', '\\.')));
    }
    checked(`${ROUTES.length} rutas: admin/user pasan el guard y el usuario con permiso negado recibe 403 con el código exacto`);

    // Cancelar y liberar no tienen DTO: el pedido inexistente devuelve 4xx distinto de 403 cuando hay permiso.
    for (const route of ['pedidos/2147483000/cancelar']) {
      assert.notEqual((await call(route, users.operator, 'POST')).status, 403);
      assert.equal((await call(route, users.denied, 'POST')).status, 403);
    }
    assert.equal((await call('pedidos/reservas/vencidas/liberar', users.denied, 'POST')).status, 403);
    assert.equal((await call('pedidos/reservas/vencidas/liberar', users.operator, 'POST')).status, 201);
    checked('Cancelar pedido y liberar apartados vencidos exigen pedidos.cancelar');

    stage = 'pago heredado';
    for (const name of ['operator', 'adminDenied']) assert.equal((await call('pago-proveedor', users[name], 'POST', {})).status, 403);
    const [compra] = (await writer.query(`SELECT id_compra, saldo_pendiente::numeric AS saldo FROM compra
      WHERE saldo_pendiente >= 0.02 AND estatus NOT IN ('Cancelada','Cancelado') ORDER BY id_compra LIMIT 1`)).rows;
    assert.ok(compra, 'La copia necesita una compra anterior con saldo para probar el pago');
    const before = (await writer.query('SELECT count(*)::int n, coalesce(sum(monto),0)::numeric s FROM pago_proveedor WHERE id_compra=$1', [compra.id_compra])).rows[0];
    const requestId = randomUUID(), payment = { requestId, idCompra: compra.id_compra, monto: 0.01, formaPago: 'Transferencia', referencia: 'H02-g' };
    const first = await call('pago-proveedor', users.admin, 'POST', payment);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const [retry, concurrent] = await Promise.all([call('pago-proveedor', users.admin, 'POST', payment), call('pago-proveedor', users.admin, 'POST', payment)]);
    assert.deepEqual([retry.status, concurrent.status], [201, 201]);
    assert.equal(retry.body.idPago, first.body.idPago); assert.equal(concurrent.body.idPago, first.body.idPago);
    const changed = await call('pago-proveedor', users.admin, 'POST', { ...payment, monto: 0.02 });
    assert.equal(changed.status, 409);
    const after = (await writer.query('SELECT count(*)::int n FROM pago_proveedor WHERE id_compra=$1', [compra.id_compra])).rows[0];
    assert.equal(after.n, before.n + 1, 'tres envíos con la misma clave deben dejar un solo pago');
    const [stored] = (await writer.query("SELECT id_user, operation_type FROM operation_idempotency WHERE request_id=$1", [requestId])).rows;
    assert.deepEqual(stored, { id_user: users.admin.id, operation_type: 'pago_proveedor' });
    checked('Pago a compra anterior: user/admin sin compras.pagar 403; admin paga una vez ante reintento y concurrencia, otro monto 409, actor registrado');

    stage = 'cuota';
    const health = client => call('health', { client });
    let limited = 0;
    for (let index = 0; index < 101; index++) if ((await health('10.20.30.40')).status === 429) limited++;
    assert.ok(limited >= 1, 'el cliente A debe agotar su cuota');
    assert.equal((await health('10.20.30.41')).status, 200);
    checked('Cuota por cliente detrás de loopback: cliente A recibe 429 y cliente B sigue en 200');
    report.passed = true; report.completedAt = new Date().toISOString();
  } finally {
    await app?.close(); await writer?.end();
    if (created && /^verify_routes_[a-f0-9]{16}$/.test(database)) {
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [database]);
      await admin.query(`DROP DATABASE "${database}"`);
      assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount, 0); report.copyRemoved = true;
    }
    await admin.end(); for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    report.lastStage = stage; fs.mkdirSync(path.join(root, '.artifacts'), { recursive: true });
    fs.writeFileSync(path.join(root, '.artifacts', 'h02-route-permissions.json'), JSON.stringify(report, null, 2) + '\n');
  }
}
main().catch(error => { console.error('Falló H02-g:', error instanceof assert.AssertionError ? error.message : error); process.exitCode = 1; });
