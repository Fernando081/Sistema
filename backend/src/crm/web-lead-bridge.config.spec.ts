import { randomBytes } from 'node:crypto';
import { bridgeConfig, bridgeStatus, transportKey } from './web-lead-bridge.config';

describe('Configuración y ventana de rotación del puente', () => {
  const now = Date.parse('2026-10-10T12:00:00.000Z');
  const key = randomBytes(32).toString('base64');
  const old = randomBytes(32).toString('base64');
  const fingerprint = randomBytes(32).toString('base64');
  const legacy = { WEB_LEAD_BRIDGE_KEY: old, WEB_LEAD_PRIVACY_VERSION: 'fixture-v1' };
  const active = { ...legacy, WEB_LEAD_BRIDGE_KEY: key, WEB_LEAD_BRIDGE_KEY_ID: 'firma-2', WEB_LEAD_FINGERPRINT_KEY: fingerprint };
  const transition = { ...active, WEB_LEAD_FINGERPRINT_KEY: old, WEB_LEAD_BRIDGE_PREVIOUS_KEY: old, WEB_LEAD_BRIDGE_PREVIOUS_ID: 'legacy',
    WEB_LEAD_BRIDGE_PREVIOUS_FROM: new Date(now - 1000).toISOString(), WEB_LEAD_BRIDGE_PREVIOUS_UNTIL: new Date(now + 1000).toISOString() };

  it('mantiene compatibilidad explícita y separa firma de huella', () => {
    const previous = bridgeConfig(legacy);
    expect(previous.fingerprintKey).toEqual(previous.key);
    expect(transportKey(previous, undefined, now, now)).toEqual(previous.key);
    const current = bridgeConfig(active);
    expect(current.fingerprintKey.toString('base64')).toBe(fingerprint);
    expect(transportKey(current, 'firma-2', now, now).toString('base64')).toBe(key);
    expect(() => transportKey(current, undefined, now, now)).toThrow('Solicitud de servicio inválida');
  });
  it('cierra configuración parcial, claves no canónicas e intervalos inseguros', () => {
    for (const invalid of [{ ...legacy, WEB_LEAD_BRIDGE_KEY_ID: 'firma-2' },
      { ...active, WEB_LEAD_BRIDGE_KEY_ID: 'legacy' }, { ...active, WEB_LEAD_BRIDGE_KEY_ID: 'a\nb' },
      { ...active, WEB_LEAD_FINGERPRINT_KEY: ' ' + fingerprint }, { ...active, WEB_LEAD_BRIDGE_KEY: 'AAAA' },
      { ...active, WEB_LEAD_FINGERPRINT_KEY: key }, { ...transition, WEB_LEAD_FINGERPRINT_KEY: fingerprint },
      { ...transition, WEB_LEAD_BRIDGE_PREVIOUS_ID: 'firma-2' }, { ...transition, WEB_LEAD_BRIDGE_PREVIOUS_KEY: key },
      { ...transition, WEB_LEAD_BRIDGE_PREVIOUS_UNTIL: '' }, { ...transition, WEB_LEAD_BRIDGE_PREVIOUS_FROM: '2026-10-10' },
      { ...transition, WEB_LEAD_BRIDGE_PREVIOUS_UNTIL: new Date(now + 86400000).toISOString() },
      { ...transition, WEB_LEAD_BRIDGE_PREVIOUS_UNTIL: transition.WEB_LEAD_BRIDGE_PREVIOUS_FROM }]) {
      expect(() => bridgeConfig(invalid)).toThrow('Recepción no disponible');
      expect(bridgeStatus(invalid, now).configured).toBe(false);
    }
  });
  it('limita clave anterior por reloj del receptor y fecha de la firma sin afectar activa', () => {
    const config = bridgeConfig(transition);
    expect(transportKey(config, undefined, now, now).toString('base64')).toBe(old);
    for (const [timestamp, clock] of [[now, now - 1001], [now, now + 1000], [now - 1001, now], [now + 1000, now]])
      expect(() => transportKey(config, undefined, timestamp, clock)).toThrow('Solicitud de servicio inválida');
    expect(transportKey(config, 'firma-2', now + 2000, now + 2000).toString('base64')).toBe(key);
    for (const id of ['otra', 'legacy', ['firma-2'], 'firma-2,firma-2'])
      expect(() => transportKey(config, id, now, now)).toThrow('Solicitud de servicio inválida');
  });
  it('estado privado proyecta solo IDs/fechas y diferencia habilitación de configuración', () => {
    const status = bridgeStatus({ ...transition, WEB_LEAD_BRIDGE_ENABLED: 'false' }, now);
    expect(status).toMatchObject({ enabled: false, configured: true, mode: 'v2', activeKeyId: 'firma-2', previous: { accepting: true } });
    expect(bridgeStatus(transition, now + 1000).previous?.accepting).toBe(false);
    expect(Object.keys(status).sort()).toEqual(['enabled', 'configured', 'mode', 'activeKeyId', 'previous'].sort());
    const serialized = JSON.stringify(status);
    for (const value of [key, old, fingerprint]) expect(serialized).not.toContain(value);
  });
});
