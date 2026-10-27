const assert = require('node:assert/strict');
function check(name) {
  assert.match(name, /^sistema_http_\d+_[a-f0-9]{6}$/);
}
async function databaseStats(client, name) {
  check(name);
  await client.query('SELECT pg_stat_clear_snapshot()');
  const row = (
    await client.query(
      'SELECT xact_commit,xact_rollback,blks_read,blks_hit,temp_bytes,deadlocks FROM pg_stat_database WHERE datname=$1',
      [name],
    )
  ).rows[0];
  assert.ok(row);
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, Number(v)]),
  );
}
async function activity(client, name) {
  check(name);
  const row = (
    await client.query(
      `SELECT count(*)::int connections,
        count(*) FILTER(WHERE state='active')::int active,
        count(*) FILTER(WHERE wait_event_type='Lock')::int waiting,
        count(*) FILTER(WHERE backend_type='client backend')::int "clientConnections",
        count(*) FILTER(WHERE backend_type<>'client backend')::int "auxiliaryConnections",
        COALESCE(max(extract(epoch FROM clock_timestamp()-xact_start)),0)::float8 AS "maxTransactionAgeSeconds",
        COALESCE(max(extract(epoch FROM clock_timestamp()-xact_start)) FILTER(WHERE backend_type='client backend'),0)::float8 AS "maxClientTransactionAgeSeconds",
        COALESCE(max(extract(epoch FROM clock_timestamp()-xact_start)) FILTER(WHERE backend_type<>'client backend'),0)::float8 AS "maxAuxiliaryTransactionAgeSeconds",
        COALESCE(max(extract(epoch FROM clock_timestamp()-xact_start)) FILTER(WHERE backend_type='autovacuum worker'),0)::float8 AS "maxAutovacuumTransactionAgeSeconds"
        FROM pg_stat_activity WHERE datname=$1`,
      [name],
    )
  ).rows[0];
  return row;
}
module.exports = { databaseStats, activity };
