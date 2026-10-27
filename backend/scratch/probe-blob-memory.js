const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setImmediate: nextTurn } = require('node:timers/promises');
async function main() {
  assert.equal(process.versions.node.split('.')[0], '24');
  assert.equal(
    typeof global.gc,
    'function',
    'Usar --expose-gc solo para este probe aislado',
  );
  const collect = async () => {
    await nextTurn();
    global.gc();
    await nextTurn();
    global.gc();
    return process.memoryUsage();
  };
  const before = await collect();
  let held = {
    buffer: Buffer.alloc(10 * 1024 * 1024, 1),
    blobs: Array.from(
      { length: 8 },
      () => new Blob([Buffer.alloc(10 * 1024 * 1024, 2)]),
    ),
  };
  const retained = await collect();
  assert.equal(held.blobs.length, 8);
  assert.equal(held.buffer.length, 10 * 1024 * 1024);
  held = null;
  const released = await collect();
  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    scope:
      'Probe aislado de Buffer/Blob con GC explícito; no usa ERP/DB ni cambia criterios del soak, no demuestra fuga del ERP',
    heldBlobBytes: 80 * 1024 * 1024,
    before,
    retained,
    released,
  };
  fs.writeFileSync(
    path.join(__dirname, '../../docs/q0453c2c3d9-blob-probe.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
