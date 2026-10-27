// Profile fixtures are declared only inside owned acceptance databases/processes.
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');

async function verifyIntakeProfile(origin, publicOrigin, counts) {
  const { profileFixture } = await import('../public-web/test/intake-profile.fixture.mjs');
  const { checkIntakeProfile, prepareIntakeProfile } = await import('../public-web/intake-profile.mjs');
  const profile = profileFixture(publicOrigin, origin, process.env.WEB_LEAD_BRIDGE_KEY_ID, process.env.WEB_LEAD_PRIVACY_VERSION);
  const env = { PUBLIC_WEB_BRIDGE_KEY: process.env.WEB_LEAD_BRIDGE_KEY, PUBLIC_WEB_FINGERPRINT_KEY: process.env.WEB_LEAD_FINGERPRINT_KEY };
  const before = await counts();
  const offline = await checkIntakeProfile(profile, env);
  assert.equal(offline.status, 'prepared-local'); assert.equal(offline.captureStarted, false);
  const online = await checkIntakeProfile(profile, env, true);
  assert.equal(online.status, 'checked-local'); assert.equal(online.backendChecked, true);
  const intake = await prepareIntakeProfile(profile, env);
  await assert.rejects(prepareIntakeProfile(profile, { ...env, PUBLIC_WEB_BRIDGE_KEY: randomBytes(32).toString('base64') }), /no confirmado/);
  await assert.rejects(prepareIntakeProfile(profile, { ...env, PUBLIC_WEB_FINGERPRINT_KEY: randomBytes(32).toString('base64') }), /no confirmado/);
  await assert.rejects(prepareIntakeProfile({ ...profile, keyId: 'unknown' }, env), /no confirmado/);
  await assert.rejects(prepareIntakeProfile({ ...profile, privacy: { ...profile.privacy, version: 'other-policy' } }, env), /no confirmado/);
  const enabled = process.env.WEB_LEAD_BRIDGE_ENABLED;
  process.env.WEB_LEAD_BRIDGE_ENABLED = 'false';
  try { await assert.rejects(prepareIntakeProfile(profile, env), /no confirmado/); }
  finally { process.env.WEB_LEAD_BRIDGE_ENABLED = enabled; }
  assert.deepEqual(await counts(), before, 'Preflight no inserta solicitudes, oportunidades, snapshots o decisiones');
  console.log('Perfil local: ambas claves/aviso/ID comprobados por HTTP firmado; errores impiden preparación y comprobación sin escrituras.');
  return intake;
}
module.exports = { verifyIntakeProfile };
