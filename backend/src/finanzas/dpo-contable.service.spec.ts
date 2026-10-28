import { diasPorPagar } from './dpo-contable.service';

describe('DPO contable (F03)', () => {
  it('saldo medio / flujo × días, con un decimal', () => {
    expect(diasPorPagar(396500, 318420.4, 90)).toBe(112.1);
    expect(diasPorPagar(50000, 100000, 30)).toBe(15);
  });

  it('no calculable sin flujo positivo o sin días', () => {
    expect(diasPorPagar(1000, 0, 90)).toBeNull();
    expect(diasPorPagar(1000, -5, 90)).toBeNull();
    expect(diasPorPagar(1000, 100, 0)).toBeNull();
  });
});
