import { ConfigService } from '@nestjs/config';
import { loadFiscalSettings } from './fiscal.config';

const config = (values: Record<string, string>) => ({ get: (key: string) => values[key] }) as ConfigService;

describe('configuración fiscal', () => {
  it('mantiene mock listo sin credenciales externas', () => {
    const settings = loadFiscalSettings(config({ FISCAL_MODE: 'mock' }));
    expect(settings).toMatchObject({ environment: 'mock', provider: 'mock', ready: true });
  });

  it('enumera lo que falta para sandbox sin exponer valores', () => {
    const settings = loadFiscalSettings(config({ FISCAL_MODE: 'sandbox', PAC_PROVIDER: 'sw' }));
    expect(settings.ready).toBe(false);
    expect(settings.missing).toContain('FISCAL_ISSUER_RFC');
    expect(settings.missing).toContain('PAC_SW_USER o PAC_SW_TOKEN');
  });

  it('exige el seguro explícito al activar producción', () => {
    const values = {
      FISCAL_MODE: 'production', PAC_PROVIDER: 'sw', FISCAL_ISSUER_RFC: 'AAA010101AAA',
      FISCAL_ISSUER_NAME: 'EMISOR', FISCAL_ISSUER_TAX_REGIME: '601',
      FISCAL_ISSUER_POSTAL_CODE: '89000', PAC_SW_TOKEN: 'token-de-prueba',
    };
    expect(loadFiscalSettings(config(values)).missing).toContain('FISCAL_PRODUCTION_ENABLED=true');
    expect(loadFiscalSettings(config({ ...values, FISCAL_PRODUCTION_ENABLED: 'true' })).ready).toBe(true);
  });
});
