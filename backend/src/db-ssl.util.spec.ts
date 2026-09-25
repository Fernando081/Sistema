import { ConfigService } from '@nestjs/config';
import { parseSsl } from './db-ssl.util';

const config = (values: Record<string, string>) => ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('parseSsl', () => {
  it.each([undefined, 'false', 'no'])('no activa TLS con %s', (value) => {
    expect(parseSsl(config(value ? { DB_SSL: value } : {}))).toBe(false);
  });
  it.each(['true', '1', 'yes', 'y', 'on', ' TRUE '])('verifica el certificado por defecto con %s', (value) => {
    expect(parseSsl(config({ DB_SSL: value }))).toEqual({ rejectUnauthorized: true });
  });
  it('permite excepción explícita solo fuera de producción', () => {
    expect(parseSsl(config({ DB_SSL: 'true', DB_SSL_REJECT_UNAUTHORIZED: 'false' }))).toEqual({ rejectUnauthorized: false });
    expect(() => parseSsl(config({ DB_SSL: 'true', DB_SSL_REJECT_UNAUTHORIZED: 'false', NODE_ENV: 'production' }))).toThrow('producción');
  });
});
