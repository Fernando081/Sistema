import { createHash } from 'node:crypto';
import { CancelInput, CancelResult, FiscalProvider, FiscalStatusResult, StampInput, StampResult } from '../fiscal.types';

function deterministicUuid(value: string): string {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

/**
 * Respuesta simulada del receptor a una cancelación (FISCAL_MOCK_CANCELACION):
 * inmediata (predeterminada) cancela al instante; pendiente deja la solicitud en espera y la primera
 * consulta la confirma; rechazada la deja en espera y la consulta informa el rechazo del receptor.
 */
export type MockCancellationMode = 'inmediata' | 'pendiente' | 'rechazada';

export class MockFiscalProvider implements FiscalProvider {
  readonly name = 'mock';
  readonly environment = 'mock' as const;

  constructor(private readonly cancellation: MockCancellationMode = 'inmediata') {}

  stamp(input: StampInput): Promise<StampResult> {
    const uuid = deterministicUuid(input.idempotencyKey);
    return Promise.resolve({
      uuid,
      xml: `${input.xml}\n<!-- MOCK UUID ${uuid}: SIN VALIDEZ FISCAL -->`,
      stampedAt: new Date().toISOString(),
      satCertificate: 'MOCK-SAT',
      cfdiCertificate: 'MOCK-CSD',
      satSeal: 'MOCK-SAT-SEAL',
      cfdiSeal: 'MOCK-CFDI-SEAL',
      satOriginalString: `MOCK|${uuid}`,
      providerCode: 'MOCK-200',
      providerMessage: 'Documento simulado; no fue enviado al SAT',
    });
  }

  cancel(input: CancelInput): Promise<CancelResult> {
    return Promise.resolve({
      accepted: true,
      cancelled: this.cancellation === 'inmediata',
      acknowledgement: `<MockCancellation UUID="${input.uuid}" Reason="${input.reason}" />`,
      code: 'MOCK-202',
      message: this.cancellation === 'inmediata' ? 'Cancelación simulada' : 'Cancelación simulada en espera del receptor',
    });
  }

  queryStatus(): Promise<FiscalStatusResult> {
    if (this.cancellation === 'rechazada') {
      return Promise.resolve({ status: 'Vigente', cancellableStatus: 'Cancelable con aceptación', cancellationStatus: 'Solicitud rechazada', rawCode: 'MOCK-S' });
    }
    return Promise.resolve({ status: 'Cancelado', cancellationStatus: 'Cancelación simulada', rawCode: 'MOCK-S' });
  }
}
