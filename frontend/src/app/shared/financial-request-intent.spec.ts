import { FinancialRequestIntent } from './financial-request-intent';
describe('Financial request intent', () => {
  it('retains uncertain requests and blocks changed content', () => {
    const intent = new FinancialRequestIntent();
    const key = intent.begin('pay', { id: 1, monto: 10 });
    for (const status of [0, 408, 409, 429, 500, 503]) {
      intent.failure('pay', status);
      expect(intent.begin('pay', { id: 1, monto: 10 })).toBe(key);
    }
    expect(() => intent.begin('pay', { id: 1, monto: 20 })).toThrowError(/pendiente/);
    intent.success('pay');
    expect(intent.begin('pay', { id: 1, monto: 20 })).not.toBe(key);
  });
  it('permits correction after definitive validation and separates operations', () => {
    const intent = new FinancialRequestIntent();
    const key = intent.begin('advance', { monto: 10 });
    expect(intent.begin('credit', { monto: 10 })).not.toBe(key);
    intent.failure('advance', 400);
    expect(intent.begin('advance', { monto: 20 })).not.toBe(key);
  });
});
