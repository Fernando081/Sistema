import { distributeGroupedPayment } from './pagos-proveedor.service';

const facturas = [
  { id: 3, saldo: 300, vence: '2026-11-30' },
  { id: 1, saldo: 100.5, vence: '2026-11-10' },
  { id: 2, saldo: 50, vence: '2026-11-10' },
];

describe('distributeGroupedPayment (U02.3)', () => {
  it('sin monto liquida cada saldo completo, ordenado por vencimiento', () => {
    expect(distributeGroupedPayment(facturas)).toEqual([
      { id: 1, monto: 100.5 }, { id: 2, monto: 50 }, { id: 3, monto: 300 },
    ]);
  });

  it('un monto parcial cubre primero lo que vence antes y abona el resto', () => {
    expect(distributeGroupedPayment(facturas, 200)).toEqual([
      { id: 1, monto: 100.5 }, { id: 2, monto: 50 }, { id: 3, monto: 49.5 },
    ]);
    expect(distributeGroupedPayment(facturas, 80)).toEqual([{ id: 1, monto: 80 }]);
  });

  it('rechaza pagar más que la suma de saldos', () => {
    expect(() => distributeGroupedPayment(facturas, 450.51)).toThrow('supera la suma de saldos');
  });
});
