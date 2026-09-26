export type FiscalEnvironment = 'mock' | 'sandbox' | 'production';
export type FiscalDocumentType = 'FACTURA' | 'REP';
export type FiscalDocumentState =
  | 'Borrador'
  | 'Procesando'
  | 'Timbrado'
  | 'Cancelacion solicitada'
  | 'Cancelado'
  | 'Error';

export interface FiscalIssuer {
  rfc: string;
  name: string;
  taxRegime: string;
  postalCode: string;
}

export interface FiscalSettings {
  environment: FiscalEnvironment;
  provider: 'mock' | 'sw';
  issuer: FiscalIssuer;
  ready: boolean;
  missing: string[];
  productionEnabled: boolean;
  sw?: {
    servicesUrl: string;
    statusUrl: string;
    user?: string;
    password?: string;
    token?: string;
  };
}

export interface StampInput {
  xml: string;
  idempotencyKey: string;
}

export interface StampResult {
  uuid: string;
  xml: string;
  stampedAt: string;
  satCertificate?: string;
  cfdiCertificate?: string;
  satSeal?: string;
  cfdiSeal?: string;
  satOriginalString?: string;
  providerCode?: string;
  providerMessage?: string;
}

export interface CancelInput {
  uuid: string;
  issuerRfc: string;
  receiverRfc: string;
  total: number;
  cfdiSeal: string;
  reason: '01' | '02' | '03' | '04';
  replacementUuid?: string;
}

export interface CancelResult {
  accepted: boolean;
  cancelled: boolean;
  acknowledgement?: string;
  code?: string;
  message?: string;
}

export interface FiscalStatusResult {
  status: 'Vigente' | 'Cancelado' | 'No encontrado' | 'Desconocido';
  cancellableStatus?: string;
  cancellationStatus?: string;
  rawCode?: string;
}

export interface FiscalProvider {
  readonly name: string;
  readonly environment: FiscalEnvironment;
  stamp(input: StampInput): Promise<StampResult>;
  cancel(input: CancelInput): Promise<CancelResult>;
  queryStatus(input: CancelInput): Promise<FiscalStatusResult>;
}

export const FISCAL_PROVIDER = Symbol('FISCAL_PROVIDER');
