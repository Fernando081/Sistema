require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { databaseConfig } = require('../db-config');
const { findPgTool, postgresEnvironment } = require('../backup');
const {
  runScheduledJob,
  readScheduledJobStatus,
} = require('../dist/common/scheduled-job');
const {
  NotificationService,
} = require('../dist/notification/notification.service');
const { DashboardService } = require('../dist/dashboard/dashboard.service');

async function main() {
  assert.equal(process.versions.node.split('.')[0], '24');
  const backupArg = process.argv.find((arg) => arg.startsWith('--backup='));
  assert.ok(backupArg, 'Falta --backup=RUTA_DEL_DUMP');
  const dump = path.resolve(backupArg.slice(9));
  assert.ok(
    dump.startsWith(path.resolve(__dirname, '../../.backups') + path.sep) &&
      fs.existsSync(dump),
  );
  const name =
    'sistema_jobs_' + Date.now() + '_' + randomBytes(3).toString('hex');
  assert.match(name, /^sistema_jobs_\d+_[a-f0-9]{6}$/);
  const base = databaseConfig();
  const admin = new Client(base);
  let created = false,
    source,
    cleaned=false;
  await admin.connect();
  try {
    assert.notEqual(
      name,
      (await admin.query('SELECT current_database() AS name')).rows[0].name,
    );
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    created = true;
    const env = { ...postgresEnvironment(), DB_NAME: name, PGDATABASE: name };
    let url;
    if (base.connectionString) {
      url = new URL(base.connectionString);
      url.pathname = '/' + name;
      env.DATABASE_URL = url.toString();
    } else delete env.DATABASE_URL;
    const child = {
      env,
      cwd: path.resolve(__dirname, '..'),
      windowsHide: true,
      stdio: 'pipe',
      timeout: 180000,
    };
    execFileSync(
      findPgTool('pg_restore'),
      ['--exit-on-error', '--no-owner', '--no-acl', '--dbname', name, dump],
      child,
    );
    execFileSync(process.execPath, ['run-migrations.js', '--check'], child);
    execFileSync(process.execPath, ['run-migrations.js'], child);
    source = new DataSource({
      type: 'postgres',
      ...(url
        ? { url: url.toString() }
        : {
            host: base.host,
            port: Number(base.port),
            username: base.user,
            password: base.password,
            database: name,
          }),
      ssl: base.ssl,
      entities: [],
      extra: { max: 6, connectionTimeoutMillis: 5000 },
    });
    await source.initialize();
    assert.equal(
      (await source.query('SELECT current_database() AS name'))[0].name,
      name,
    );
    await source.query(
      "DELETE FROM operational_job_run WHERE job_name IN ('operational_alerts','dashboard_freshness')",
    );
    await source.query("DELETE FROM app_notification WHERE source_type='scheduled_job'");
    await source.query(
      "UPDATE operational_job SET installed_at='2026-10-05T09:12:00Z' WHERE interval_seconds IS NOT NULL",
    );
    const statusAt = async (now) =>
      (
        await source.query('SELECT fn_scheduled_job_status($1) AS jobs', [now])
      )[0].jobs;
    assert.ok(
      (await statusAt('2026-10-05T09:15:00Z')).every((job) => !job.overdue),
    );
    assert.ok(
      (await statusAt('2026-10-05T09:24:59Z')).every((job) => !job.overdue),
    );
    assert.ok(
      (await statusAt('2026-10-05T09:25:00Z')).every((job) => job.overdue),
    );
    await source.query(
      'UPDATE operational_job SET installed_at=clock_timestamp() WHERE interval_seconds IS NOT NULL',
    );
    let entered, unblock;
    const enteredPromise = new Promise((resolve) => (entered = resolve));
    const block = new Promise((resolve) => (unblock = resolve));
    const first = runScheduledJob(
      source,
      'operational_alerts',
      async () => {
        entered();
        await block;
      },
      () => {},
    );
    await enteredPromise;
    try {
      assert.equal(
        await runScheduledJob(
          source,
          'operational_alerts',
          async () => {
            throw new Error('No debe ejecutarse');
          },
          () => {},
        ),
        'skipped',
      );
    } finally {
      unblock();
      await first;
    }
    assert.equal(
      (
        await source.query(
          "SELECT count(*)::int n FROM operational_job_run WHERE job_name='operational_alerts'",
        )
      )[0].n,
      1,
    );
    await assert.rejects(
      runScheduledJob(
        source,
        'operational_alerts',
        async () => {
          throw new Error('private-test-failure');
        },
        () => {},
      ),
      /private-test-failure/,
    );
    let jobs = await readScheduledJobStatus(source);
    assert.equal(
      jobs.find((job) => job.name === 'operational_alerts').lastRun.status,
      'failed',
    );
    assert.ok(!JSON.stringify(jobs).includes('private-test-failure'));
    const activeAdmins=(await source.query("SELECT count(*)::int n FROM auth_user WHERE is_active AND role='admin'"))[0].n;
    assert.ok(activeAdmins>0,'El respaldo exige administrador activo para comprobar avisos');
    const failedAlerts=await source.query("SELECT id_notification,type,severity,read_at FROM app_notification WHERE source_type='scheduled_job' AND type='scheduled_job_failed'");
    assert.equal(failedAlerts.length,activeAdmins);assert.ok(failedAlerts.every(row=>row.severity==='critical'));
    const notifications = new NotificationService(source);
    await notifications.scheduledRefreshOperationalAlerts();
    jobs = await readScheduledJobStatus(source);
    assert.equal(
      jobs.find((job) => job.name === 'operational_alerts').lastRun.status,
      'success',
    );
    const recovered=await source.query('SELECT type,severity,read_at FROM app_notification WHERE id_notification=ANY($1::bigint[])',[failedAlerts.map(row=>row.id_notification)]);
    assert.ok(recovered.every(row=>row.type==='scheduled_job_recovered'&&row.severity==='info'&&row.read_at));
    const beforeManual = (
      await source.query('SELECT count(*)::int n FROM operational_job_run')
    )[0].n;
    await notifications.refreshOperationalAlerts();
    assert.equal(
      (await source.query('SELECT count(*)::int n FROM operational_job_run'))[0]
        .n,
      beforeManual,
    );
    await new DashboardService(source).checkRefreshFreshness();
    jobs = await readScheduledJobStatus(source);
    assert.equal(
      jobs.find((job) => job.name === 'dashboard_freshness').lastRun.status,
      'success',
    );
    for (let i = 0; i < 25; i++)
      await source.query(
        "INSERT INTO operational_job_run(id,job_name,status) VALUES($1,'dashboard_freshness','running')",
        [randomUUID()],
      );
    jobs = await readScheduledJobStatus(source);
    const monitor = jobs.find((job) => job.name === 'dashboard_freshness');
    assert.equal(monitor.recentRuns.length, 20);
    assert.equal(monitor.lastRun.status, 'running');
    assert.ok(monitor.lastSuccessAt);
    assert.equal(
      (
        await source.query(
          "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND state LIKE 'idle in transaction%'",
        )
      )[0].n,
      0,
    );
    console.log(
      'Jobs: concurrencia PG, fallo/recuperacion, servicios reales, consulta manual, horario e historial aprobados.',
    );
  } finally {
    try {
      if (source?.isInitialized) await source.destroy();
    } finally {
      try {
        if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
        assert.equal(
          (
            await admin.query(
              'SELECT count(*)::int n FROM pg_database WHERE datname=$1',
              [name],
            )
          ).rows[0].n,
          0,
        );
        cleaned=true;
      } finally {
        await admin.end();
      }
    }
  }
  fs.writeFileSync(path.join(__dirname,'../../.artifacts/o024-operational-jobs-copy.json'),JSON.stringify({
    phase:'O02.4',generatedAt:new Date().toISOString(),node:process.versions.node,
    source:'restored-test-database',passed:true,cleaned,
    checks:['Restauración propia/db:check antes de db:migrate','Concurrencia PostgreSQL/guardia sin intento ficticio',
      'Fallo real y aviso crítico por ADMIN activo','Callback NotificationService real/éxito/aviso recuperado',
      'Consulta manual no genera historial de cron','Callback DashboardService real/último éxito',
      'Instalación/tolerancia y veinte intentos de historial','Cero transacciones ociosas y copia eliminada'],
    limits:['Servicios y tablas completos en copia; no AppModule HTTP/UI completo ni monitor externo.']},null,2)+'\n');
  console.log('Copia de prueba eliminada; base operacional conservada.');
}
main().catch(() => {
  console.error('No se completo la validacion aislada de jobs.');
  process.exitCode = 1;
});
