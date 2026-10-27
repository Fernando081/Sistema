const assert = require('node:assert/strict');
const { activity } = require('./list-postgres-metrics');

// Execute the actual aggregate SQL against deterministic PostgreSQL rows.
// No real sessions, operational records or server settings are changed.
async function verifyTransactionAge(client, name) {
  const rows = `(
    VALUES
      ($1::text,'client backend','active','Lock',clock_timestamp()-interval '2 seconds'),
      ($1::text,'autovacuum worker','active',NULL,clock_timestamp()-interval '9 seconds'),
      ($1::text,'parallel worker','active',NULL,clock_timestamp()-interval '5 seconds'),
      ('other_database','client backend','active','Lock',clock_timestamp()-interval '100 seconds')
    ) AS fixture(datname,backend_type,state,wait_event_type,xact_start)`;
  const adapter = (source) => ({
    query: (sql, args) => {
      assert.ok(sql.includes('FROM pg_stat_activity WHERE datname=$1'));
      return client.query(
        sql.replace('FROM pg_stat_activity', `FROM ${source}`),
        args,
      );
    },
  });
  const sample = await activity(adapter(rows), name);
  assert.equal(sample.connections, 3);
  assert.equal(sample.clientConnections, 1);
  assert.equal(sample.auxiliaryConnections, 2);
  assert.equal(sample.waiting, 1);
  for (const [key, seconds] of Object.entries({
    maxTransactionAgeSeconds: 9,
    maxClientTransactionAgeSeconds: 2,
    maxAuxiliaryTransactionAgeSeconds: 9,
    maxAutovacuumTransactionAgeSeconds: 9,
  }))
    assert.ok(sample[key] >= seconds && sample[key] < seconds + 1, key);
  const empty = await activity(
    adapter(`(SELECT * FROM ${rows} WHERE false) AS empty_sessions`),
    name,
  );
  assert.ok(Object.values(empty).every((value) => value === 0));
  return {
    mixedBackendTypes: true,
    otherDatabaseExcluded: true,
    emptyGroupsZero: true,
  };
}
module.exports = { verifyTransactionAge };
