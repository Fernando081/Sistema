import { ConfigService } from '@nestjs/config';
import { parseSsl } from './db-ssl.util';

function makeConfigService(values: Record<string, string>): ConfigService {
  return {
    get: (key: string, defaultValue?: string) =>
      values[key] ?? defaultValue ?? undefined,
  } as unknown as ConfigService;
}

describe('parseSsl', () => {
  it('returns false when DB_SSL is not set', () => {
    const configService = makeConfigService({});
    expect(parseSsl(configService)).toBe(false);
  });

  it('returns false when DB_SSL is "false"', () => {
    const configService = makeConfigService({ DB_SSL: 'false' });
    expect(parseSsl(configService)).toBe(false);
  });

  it('returns false when DB_SSL is "no"', () => {
    const configService = makeConfigService({ DB_SSL: 'no' });
    expect(parseSsl(configService)).toBe(false);
  });

  it('returns ssl object with rejectUnauthorized=false when DB_SSL is "true"', () => {
    const configService = makeConfigService({ DB_SSL: 'true' });
    expect(parseSsl(configService)).toEqual({ rejectUnauthorized: false });
  });

  it('returns ssl object with rejectUnauthorized=false when DB_SSL is "1"', () => {
    const configService = makeConfigService({ DB_SSL: '1' });
    expect(parseSsl(configService)).toEqual({ rejectUnauthorized: false });
  });

  it('returns ssl object with rejectUnauthorized=false when DB_SSL is "yes"', () => {
    const configService = makeConfigService({ DB_SSL: 'yes' });
    expect(parseSsl(configService)).toEqual({ rejectUnauthorized: false });
  });

  it('returns ssl object with rejectUnauthorized=false when DB_SSL is "on"', () => {
    const configService = makeConfigService({ DB_SSL: 'on' });
    expect(parseSsl(configService)).toEqual({ rejectUnauthorized: false });
  });

  it('returns ssl object with rejectUnauthorized=true when DB_SSL_REJECT_UNAUTHORIZED is "true"', () => {
    const configService = makeConfigService({
      DB_SSL: 'true',
      DB_SSL_REJECT_UNAUTHORIZED: 'true',
    });
    expect(parseSsl(configService)).toEqual({ rejectUnauthorized: true });
  });

  it('returns ssl object with rejectUnauthorized=false when DB_SSL_REJECT_UNAUTHORIZED is "false"', () => {
    const configService = makeConfigService({
      DB_SSL: 'true',
      DB_SSL_REJECT_UNAUTHORIZED: 'false',
    });
    expect(parseSsl(configService)).toEqual({ rejectUnauthorized: false });
  });

  it('returns ssl object with rejectUnauthorized=true when DB_SSL_REJECT_UNAUTHORIZED is "1"', () => {
    const configService = makeConfigService({
      DB_SSL: 'true',
      DB_SSL_REJECT_UNAUTHORIZED: '1',
    });
    expect(parseSsl(configService)).toEqual({ rejectUnauthorized: true });
  });

  it('returns ssl object with rejectUnauthorized=false when DB_SSL_REJECT_UNAUTHORIZED is "no"', () => {
    const configService = makeConfigService({
      DB_SSL: 'true',
      DB_SSL_REJECT_UNAUTHORIZED: 'no',
    });
    expect(parseSsl(configService)).toEqual({ rejectUnauthorized: false });
  });

  it('returns ssl object with rejectUnauthorized=true when DB_SSL_REJECT_UNAUTHORIZED is "yes"', () => {
    const configService = makeConfigService({
      DB_SSL: 'true',
      DB_SSL_REJECT_UNAUTHORIZED: 'yes',
    });
    expect(parseSsl(configService)).toEqual({ rejectUnauthorized: true });
  });

  it('returns ssl object with rejectUnauthorized=true when DB_SSL_REJECT_UNAUTHORIZED is "y"', () => {
    const configService = makeConfigService({
      DB_SSL: 'true',
      DB_SSL_REJECT_UNAUTHORIZED: 'y',
    });
    expect(parseSsl(configService)).toEqual({ rejectUnauthorized: true });
  });

  it('returns ssl object with rejectUnauthorized=true when DB_SSL_REJECT_UNAUTHORIZED is "on"', () => {
    const configService = makeConfigService({
      DB_SSL: 'true',
      DB_SSL_REJECT_UNAUTHORIZED: 'on',
    });
    expect(parseSsl(configService)).toEqual({ rejectUnauthorized: true });
  });
  it('handles mixed-case DB_SSL value', () => {
    const configService = makeConfigService({ DB_SSL: 'TRUE' });
    expect(parseSsl(configService)).toEqual({ rejectUnauthorized: false });
  });

  it('handles DB_SSL with surrounding whitespace', () => {
    const configService = makeConfigService({ DB_SSL: '  yes  ' });
    expect(parseSsl(configService)).toEqual({ rejectUnauthorized: false });
  });

  it('handles mixed-case DB_SSL_REJECT_UNAUTHORIZED value', () => {
    const configService = makeConfigService({
      DB_SSL: 'true',
      DB_SSL_REJECT_UNAUTHORIZED: 'TRUE',
    });
    expect(parseSsl(configService)).toEqual({ rejectUnauthorized: true });
  });

  it('handles DB_SSL_REJECT_UNAUTHORIZED with surrounding whitespace', () => {
    const configService = makeConfigService({
      DB_SSL: 'true',
      DB_SSL_REJECT_UNAUTHORIZED: '  true  ',
    });
    expect(parseSsl(configService)).toEqual({ rejectUnauthorized: true });
  });
});
