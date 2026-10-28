import { throttleTracker } from './client-throttler.guard';

describe('throttleTracker', () => {
  it('separa clientes que llegan por el proxy local', () => {
    const viaProxy = (client: string) =>
      throttleTracker({
        socket: { remoteAddress: '127.0.0.1' },
        headers: { 'x-forwarded-for': client },
      });
    expect(viaProxy('192.168.1.20')).toBe('192.168.1.20');
    expect(viaProxy('192.168.1.21')).toBe('192.168.1.21');
  });

  it('usa la dirección agregada por el proxy, no la que envía el cliente', () => {
    expect(
      throttleTracker({
        socket: { remoteAddress: '::1' },
        headers: { 'x-forwarded-for': '10.0.0.99, 192.168.1.20' },
      }),
    ).toBe('192.168.1.20');
  });

  it('ignora X-Forwarded-For de conexiones que no son locales', () => {
    expect(
      throttleTracker({
        socket: { remoteAddress: '192.168.1.50' },
        headers: { 'x-forwarded-for': '1.2.3.4' },
      }),
    ).toBe('192.168.1.50');
  });

  it('conserva la dirección del socket si el proxy no agrega cabecera', () => {
    expect(
      throttleTracker({ socket: { remoteAddress: '127.0.0.1' }, headers: {} }),
    ).toBe('127.0.0.1');
  });
});
