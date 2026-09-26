import { MockFiscalProvider } from './mock-fiscal.provider';

describe('MockFiscalProvider', () => {
  const provider = new MockFiscalProvider();

  it('genera un UUID determinista para reintentos idempotentes', async () => {
    const first = await provider.stamp({ xml: '<cfdi/>', idempotencyKey: 'FACTURA:1' });
    const retry = await provider.stamp({ xml: '<cfdi/>', idempotencyKey: 'FACTURA:1' });
    expect(first.uuid).toBe(retry.uuid);
    expect(first.xml).toContain('SIN VALIDEZ FISCAL');
  });

  it('simula cancelación confirmada sin red', async () => {
    const result = await provider.cancel({ uuid: '00000000-0000-4000-8000-000000000000',
      issuerRfc: 'AAA010101AAA', receiverRfc: 'XAXX010101000', total: 116,
      cfdiSeal: 'MOCK', reason: '03' });
    expect(result).toMatchObject({ accepted: true, cancelled: true, code: 'MOCK-202' });
  });
});
