// Used only by isolated PostgreSQL verifiers; never configures the operational process.
const assert = require('node:assert/strict');
const { randomBytes, createHmac } = require('node:crypto');
const { createLeadBridge } = require('../public-web/lead-bridge.mjs');

async function verifyBridgeRotation(origin, fingerprintKey, lead, getRow, purge) {
  const hash = value => { const { requestId, ...payload } = value; return createHmac('sha256', fingerprintKey).update(JSON.stringify(payload)).digest('hex'); };
  const fingerprint = hash(lead);
  const original = await getRow();
  const legacy = createLeadBridge(origin, fingerprintKey);
  const next = randomBytes(32);
  Object.assign(process.env, { WEB_LEAD_BRIDGE_KEY: next.toString('base64'), WEB_LEAD_BRIDGE_KEY_ID: 'fixture-2',
    WEB_LEAD_FINGERPRINT_KEY: fingerprintKey.toString('base64'), WEB_LEAD_BRIDGE_PREVIOUS_KEY: fingerprintKey.toString('base64'),
    WEB_LEAD_BRIDGE_PREVIOUS_ID: 'legacy', WEB_LEAD_BRIDGE_PREVIOUS_FROM: new Date(Date.now() - 5000).toISOString(),
    WEB_LEAD_BRIDGE_PREVIOUS_UNTIL: new Date(Date.now() + 60000).toISOString() });
  const v2 = createLeadBridge(origin, next, { keyId: 'fixture-2' });
  await Promise.all([legacy(lead, fingerprint), v2(lead, fingerprint)]);
  assert.deepEqual(await getRow(), original, 'Rotación no modifica solicitud ni huella histórica');
  const send = async (id, signedId = id, signingKey = next, timestamp = String(Date.now())) => {
    const body = JSON.stringify({ lead, fingerprint });
    const domain = signedId === undefined ? `web-lead-v1\n${timestamp}\n${body}` : `web-lead-v2\n${signedId}\n${timestamp}\n${body}`;
    const response = await fetch(origin + '/api/v1/web-lead-bridge', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Web-Timestamp': timestamp,
        'X-Web-Signature': createHmac('sha256', signingKey).update(domain).digest('hex'), ...(id === undefined ? {} : { 'X-Web-Key-Id': id }) }, body });
    await response.text(); return response.status;
  };
  assert.equal(await send('unknown'), 401);
  assert.equal(await send('fixture-2', 'another'), 401, 'ID está incluido en firma');
  assert.equal(await send(undefined, undefined, next), 401, 'No acepta firma v1 con clave activa v2');
  assert.equal(await send('fixture-2', 'fixture-2', next, String(Date.now() - 120000)), 401);
  await assert.rejects(v2(lead, createHmac('sha256', next).update(JSON.stringify(lead)).digest('hex')), /no confirmada/);
  const changed = { ...lead, items: lead.items.map((item, index) => index ? item : { ...item, quantity: item.quantity + 1 }) };
  await assert.rejects(v2(changed, hash(changed)), /no confirmada/);
  assert.deepEqual(await getRow(), original);

  const current = randomBytes(32);
  Object.assign(process.env, { WEB_LEAD_BRIDGE_KEY: current.toString('base64'), WEB_LEAD_BRIDGE_KEY_ID: 'fixture-3',
    WEB_LEAD_BRIDGE_PREVIOUS_KEY: next.toString('base64'), WEB_LEAD_BRIDGE_PREVIOUS_ID: 'fixture-2' });
  const v3 = createLeadBridge(origin, current, { keyId: 'fixture-3' });
  await Promise.all([v2(lead, fingerprint), v3(lead, fingerprint)]);
  await assert.rejects(legacy(lead, fingerprint), /no confirmada/);
  Object.assign(process.env, { WEB_LEAD_BRIDGE_PREVIOUS_FROM: new Date(Date.now() - 120000).toISOString(),
    WEB_LEAD_BRIDGE_PREVIOUS_UNTIL: new Date(Date.now() - 1000).toISOString() });
  await assert.rejects(v2(lead, fingerprint), /no confirmada/);
  await v3(lead, fingerprint); // Expiration of previous key never disables current key.
  for (const field of ['KEY', 'ID', 'FROM', 'UNTIL']) delete process.env['WEB_LEAD_BRIDGE_PREVIOUS_' + field];
  await assert.rejects(v2(lead, fingerprint), /no confirmada/);
  await v3(lead, fingerprint);
  process.env.WEB_LEAD_BRIDGE_PREVIOUS_ID = 'fixture-2'; // Partial config fails closed.
  await assert.rejects(v3(lead, fingerprint), /no confirmada/);
  delete process.env.WEB_LEAD_BRIDGE_PREVIOUS_ID;
  if (purge) {
    await purge();
    const purged = await getRow(); assert.equal(purged.payload, null);
    await Promise.all([v3(lead, fingerprint), v3(lead, fingerprint)]);
    assert.deepEqual(await getRow(), purged, 'Reintento rotado no restaura payload purgado');
    await assert.rejects(v3(changed, hash(changed)), /no confirmada/);
  }
  console.log('Rotación HTTP: legacy→v2→v2, clave anterior acotada/revocada, ID firmado, huella estable y conflicto aprobados.');
  return v3;
}
module.exports = { verifyBridgeRotation };
