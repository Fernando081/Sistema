const assert = require('node:assert/strict');
const { tracker } = require('./list-business-metrics');
const t = tracker();
const table = { deadTuples: 3, liveTuples: 10, autovacuumCount: 1 };
const row = (cpu, read, write, created = 'one') => ({
  ProcessId: 1,
  CreationDate: created,
  WorkingSetSize: 100,
  KernelModeTime: cpu,
  UserModeTime: 0,
  ReadTransferCount: read,
  WriteTransferCount: write,
});
t.add({
  tables: table,
  os: { available: true, rows: [row(10000000, 100, 200)] },
});
t.add({ tables: table, os: { available: false } });
assert.equal(t.result.unavailableSamples, 1);
assert.equal(t.result.cpuMillisecondsDelta, 0);
t.add({
  tables: table,
  os: { available: true, rows: [row(20000000, 120, 250)] },
});
assert.equal(t.result.cpuMillisecondsDelta, 1000);
assert.equal(t.result.readTransferBytesDelta, 20);
assert.equal(t.result.writeTransferBytesDelta, 50);
// Una reutilización de PID no hereda los contadores del proceso anterior.
t.add({
  tables: table,
  os: { available: true, rows: [row(90000000, 900, 900, 'two')] },
});
assert.equal(t.result.cpuMillisecondsDelta, 1000);
assert.equal(t.result.readTransferBytesDelta, 20);
t.add({
  tables: table,
  os: { available: true, rows: [row(80000000, 800, 800, 'two')] },
});
assert.equal(t.result.cpuMillisecondsDelta, 1000);
assert.equal(t.result.readTransferBytesDelta, 20);
console.log(
  'Métricas: disponibilidad, diferencias y reutilización de PID verificadas.',
);
