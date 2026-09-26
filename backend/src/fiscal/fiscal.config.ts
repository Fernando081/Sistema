import { ConfigService } from '@nestjs/config';
import { FiscalEnvironment, FiscalSettings } from './fiscal.types';

const clean = (value: string | undefined) => value?.trim() || undefined;

export function loadFiscalSettings(config: ConfigService): FiscalSettings {
  const environment = clean(config.get<string>('FISCAL_MODE')) || 'mock';
  if (!['mock', 'sandbox', 'production'].includes(environment)) {
    throw new Error('FISCAL_MODE debe ser mock, sandbox o production');
  }
  const fiscalEnvironment = environment as FiscalEnvironment;
  const provider = fiscalEnvironment === 'mock'
    ? 'mock'
    : (clean(config.get<string>('PAC_PROVIDER')) || 'sw');
  if (!['mock', 'sw'].includes(provider)) throw new Error('PAC_PROVIDER no soportado');

  const issuer = {
    rfc: clean(config.get<string>('FISCAL_ISSUER_RFC')) || '',
    name: clean(config.get<string>('FISCAL_ISSUER_NAME')) || '',
    taxRegime: clean(config.get<string>('FISCAL_ISSUER_TAX_REGIME')) || '',
    postalCode: clean(config.get<string>('FISCAL_ISSUER_POSTAL_CODE')) || '',
  };
  const swUser = clean(config.get<string>('PAC_SW_USER'));
  const swPassword = clean(config.get<string>('PAC_SW_PASSWORD'));
  const swToken = clean(config.get<string>('PAC_SW_TOKEN'));
  const productionEnabled = clean(config.get<string>('FISCAL_PRODUCTION_ENABLED')) === 'true';
  const missing: string[] = [];

  if (fiscalEnvironment !== 'mock') {
    if (!issuer.rfc) missing.push('FISCAL_ISSUER_RFC');
    if (!issuer.name) missing.push('FISCAL_ISSUER_NAME');
    if (!issuer.taxRegime) missing.push('FISCAL_ISSUER_TAX_REGIME');
    if (!issuer.postalCode) missing.push('FISCAL_ISSUER_POSTAL_CODE');
    if (!swToken && !swUser) missing.push('PAC_SW_USER o PAC_SW_TOKEN');
    if (!swToken && !swPassword) missing.push('PAC_SW_PASSWORD o PAC_SW_TOKEN');
  }
  if (fiscalEnvironment === 'production' && !productionEnabled) {
    missing.push('FISCAL_PRODUCTION_ENABLED=true');
  }

  return {
    environment: fiscalEnvironment,
    provider: provider as 'mock' | 'sw',
    issuer,
    ready: missing.length === 0,
    missing,
    productionEnabled,
    sw: provider === 'sw' ? {
      servicesUrl: fiscalEnvironment === 'production'
        ? 'https://services.sw.com.mx'
        : 'https://services.test.sw.com.mx',
      statusUrl: fiscalEnvironment === 'production'
        ? 'https://consultaqr.facturaelectronica.sat.gob.mx'
        : 'https://api.test.sw.com.mx',
      user: swUser,
      password: swPassword,
      token: swToken,
    } : undefined,
  };
}
