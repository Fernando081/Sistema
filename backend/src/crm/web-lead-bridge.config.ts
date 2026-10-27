import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

export const bridgeEnvironmentKeys = [
  'WEB_LEAD_BRIDGE_ENABLED', 'WEB_LEAD_BRIDGE_KEY', 'WEB_LEAD_PRIVACY_VERSION',
  'WEB_LEAD_BRIDGE_KEY_ID', 'WEB_LEAD_FINGERPRINT_KEY', 'WEB_LEAD_BRIDGE_PREVIOUS_KEY',
  'WEB_LEAD_BRIDGE_PREVIOUS_ID', 'WEB_LEAD_BRIDGE_PREVIOUS_FROM', 'WEB_LEAD_BRIDGE_PREVIOUS_UNTIL',
] as const;
const rotationFields = bridgeEnvironmentKeys.slice(3);
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/;
type Environment = Record<string, string | undefined>;
interface BridgeConfig {
  mode: 'legacy' | 'v2'; policy: string; key: Buffer; fingerprintKey: Buffer; keyId: string;
  previous?: { key: Buffer; id: string; from: number; until: number };
}
const unavailable = () => new ServiceUnavailableException('Recepción no disponible');
function secret(value: string | undefined): Buffer {
  if (!value || value.length > 4096) throw unavailable();
  const key = Buffer.from(value, 'base64');
  if (key.length < 32 || key.toString('base64') !== value) throw unavailable();
  return key;
}
function date(value: string | undefined): number {
  if (!value) throw unavailable();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw unavailable();
  return parsed;
}
// Transport rotates; fingerprint stays stable even after payload purging.
export function bridgeConfig(env: Environment = process.env): BridgeConfig {
  const policy = env.WEB_LEAD_PRIVACY_VERSION;
  if (!policy || !policy.trim() || policy.length > 80) throw unavailable();
  const key = secret(env.WEB_LEAD_BRIDGE_KEY);
  if (!rotationFields.some(field => !!env[field]))
    return { mode: 'legacy', policy, key, fingerprintKey: key, keyId: 'legacy' };
  const keyId = env.WEB_LEAD_BRIDGE_KEY_ID;
  if (!keyId || !identifier.test(keyId) || keyId === 'legacy') throw unavailable();
  const fingerprintKey = secret(env.WEB_LEAD_FINGERPRINT_KEY);
  if (fingerprintKey.equals(key)) throw unavailable();
  const config: BridgeConfig = { mode: 'v2', policy, key, fingerprintKey, keyId };
  if (bridgeEnvironmentKeys.slice(5).some(field => !!env[field])) {
    const id = env.WEB_LEAD_BRIDGE_PREVIOUS_ID;
    if (!id || !identifier.test(id) || id === keyId) throw unavailable();
    const previousKey = secret(env.WEB_LEAD_BRIDGE_PREVIOUS_KEY);
    if (previousKey.equals(key)) throw unavailable();
    if (id === 'legacy' && !previousKey.equals(fingerprintKey)) throw unavailable();
    const from = date(env.WEB_LEAD_BRIDGE_PREVIOUS_FROM);
    const until = date(env.WEB_LEAD_BRIDGE_PREVIOUS_UNTIL);
    if (until <= from || until - from > 24 * 60 * 60 * 1000) throw unavailable();
    config.previous = { key: previousKey, id, from, until };
  }
  return config;
}
export function transportKey(config: BridgeConfig, id: unknown, timestamp: number, now = Date.now()) {
  // Missing ID selects v1; explicit "legacy" and duplicate header arrays are invalid.
  if (id !== undefined && (typeof id !== 'string' || !identifier.test(id) || id === 'legacy'))
    throw new UnauthorizedException('Solicitud de servicio inválida');
  const requested = id === undefined ? 'legacy' : id;
  if (requested === config.keyId) return config.key;
  const previous = config.previous;
  if (previous?.id === requested && now >= previous.from && now < previous.until &&
    timestamp >= previous.from && timestamp < previous.until) return previous.key;
  throw new UnauthorizedException('Solicitud de servicio inválida');
}
export function bridgeStatus(env: Environment = process.env, now = Date.now()) {
  const enabled = env.WEB_LEAD_BRIDGE_ENABLED === 'true';
  try {
    const config = bridgeConfig(env);
    const previous = config.previous;
    return { enabled, configured: true, mode: config.mode, activeKeyId: config.keyId,
      previous: previous ? { keyId: previous.id, from: new Date(previous.from).toISOString(),
        until: new Date(previous.until).toISOString(), accepting: now >= previous.from && now < previous.until } : null };
  } catch {
    // No inputs, secrets, digests or detailed configuration errors in the response.
    return { enabled, configured: false, mode: 'unconfigured', activeKeyId: null, previous: null };
  }
}
