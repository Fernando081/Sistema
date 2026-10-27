require('reflect-metadata');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { randomBytes } = require('node:crypto');
const { databaseConfig } = require('../db-config');
const {
  syncDashboardRefreshAlert,
} = require('../dist/dashboard/dashboard-refresh-alert');
async function main() {
  assert.equal(process.versions.node.split('.')[0], '24');
  const client = new Client(databaseConfig());
  await client.connect();
  const schema = 'refresh_alert_verify_' + randomBytes(8).toString('hex');
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(`CREATE TABLE auth_user(id_user int PRIMARY KEY,is_active boolean,role text);
      CREATE TABLE app_notification(id_user int REFERENCES auth_user,type varchar(40),title varchar(160),message varchar(500),severity varchar(12),route varchar(240),source_type varchar(50),dedupe_key varchar(180) UNIQUE,read_at timestamptz,created_at timestamptz DEFAULT clock_timestamp());
      INSERT INTO auth_user VALUES(1,true,'admin'),(2,true,'user'),(3,false,'admin');`);
    const dataSource = { query: (sql) => client.query(sql) };
    await syncDashboardRefreshAlert(dataSource, true);
    await client.query('UPDATE app_notification SET read_at=clock_timestamp()');
    await syncDashboardRefreshAlert(dataSource, true);
    let rows = (await client.query('SELECT * FROM app_notification')).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id_user, 1);
    assert.equal(rows[0].read_at, null);
    assert.equal(rows[0].severity, 'critical');
    assert.equal(rows[0].title, 'No se actualizaron las métricas');
    await syncDashboardRefreshAlert(dataSource, false);
    rows = (await client.query('SELECT * FROM app_notification')).rows;
    assert.ok(rows[0].read_at);
    assert.ok(rows[0].message.includes('correctamente'));
    assert.equal(rows[0].title, 'Métricas actualizadas');
    assert.equal(rows[0].severity, 'info');
    await syncDashboardRefreshAlert(dataSource, true);
    rows = (await client.query('SELECT * FROM app_notification')).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].read_at, null);
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
    'Alertas dashboard: destinatarios, deduplicacion, recurrencia, recuperacion y rollback aprobados.',
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
