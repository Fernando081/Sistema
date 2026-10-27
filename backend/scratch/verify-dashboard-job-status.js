require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { databaseConfig } = require('../db-config');
const {
  syncMissedDashboardAlert,
} = require('../dist/dashboard/dashboard-job-status');
async function main() {
  assert.equal(process.versions.node.split('.')[0], '24');
  const client = new Client(databaseConfig());
  await client.connect();
  const schema = 'job_status_verify_' + randomBytes(8).toString('hex');
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(
      fs.readFileSync(
        path.join(__dirname, '../migrations/086_estado_refresco_dashboard.sql'),
        'utf8',
      ),
    );
    const status = async (now) =>
      (await client.query('SELECT fn_dashboard_refresh_status($1) AS s', [now]))
        .rows[0].s;
    await client.query(
      "UPDATE operational_job SET installed_at='2026-10-05T12:00:00Z'",
    );
    assert.equal(
      (await status('2026-10-05T13:00:00Z')).overdue,
      false,
      'no inventar omision previa a instalacion',
    );
    await client.query(
      "UPDATE operational_job SET installed_at='2026-10-04T00:00:00Z'",
    );
    assert.equal((await status('2026-10-05T08:29:59Z')).overdue, false);
    assert.equal((await status('2026-10-05T08:30:00Z')).overdue, true);
    assert.equal(
      new Date((await status('2026-10-06T07:59:00Z')).expectedAt).toISOString(),
      '2026-10-05T08:00:00.000Z',
    );
    const id = randomUUID();
    await client.query(
      "INSERT INTO operational_job_run(id,job_name,started_at,finished_at,status) VALUES($1,'dashboard_refresh','2026-10-05T08:00:00Z','2026-10-05T08:10:00Z','success')",
      [id],
    );
    assert.equal((await status('2026-10-05T08:31:00Z')).freshness, 'current');
    assert.equal((await status('2026-10-06T08:31:00Z')).overdue, true);
    await client.query(`CREATE TABLE auth_user(id_user int PRIMARY KEY,is_active boolean,role text);
      CREATE TABLE app_notification(id_user int,type varchar(40),title varchar(160),message varchar(500),severity varchar(12),route varchar(240),source_type varchar(50),dedupe_key varchar(180) UNIQUE,read_at timestamptz,created_at timestamptz DEFAULT clock_timestamp());
      INSERT INTO auth_user VALUES(1,true,'admin'),(2,true,'user'),(3,false,'admin');`);
    await client.query('DELETE FROM operational_job_run');
    const source = {
      query: async (sql, params) => (await client.query(sql, params)).rows,
    };
    await syncMissedDashboardAlert(source);
    await syncMissedDashboardAlert(source);
    let rows = (await client.query('SELECT * FROM app_notification')).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id_user, 1);
    await client.query(
      "INSERT INTO operational_job_run(id,job_name,started_at,finished_at,status) VALUES($1,'dashboard_refresh',clock_timestamp(),clock_timestamp(),'success')",
      [randomUUID()],
    );
    await syncMissedDashboardAlert(source);
    rows = (await client.query('SELECT * FROM app_notification')).rows;
    assert.ok(rows[0].read_at);
    for (let i = 0; i < 25; i++)
      await client.query(
        "INSERT INTO operational_job_run(id,job_name,status) VALUES($1,'dashboard_refresh','running')",
        [randomUUID()],
      );
    const recent = (
      await client.query('SELECT fn_dashboard_refresh_status() AS s')
    ).rows[0].s;
    assert.equal(recent.recentRuns.length, 20);
    assert.equal(recent.lastRun.status, 'running');
    assert.ok(recent.lastSuccessAt);
  } finally {
    await client.query('ROLLBACK');
    assert.equal(
      (
        await client.query(
          'SELECT count(*)::int n FROM pg_namespace WHERE nspname=$1',
          [schema],
        )
      ).rows[0].n,
      0,
    );
    await client.end();
  }
  console.log(
    'Estado dashboard: horario Mexico, gracia, instalacion, omision, recuperacion, historial y rollback aprobados.',
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
