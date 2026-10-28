import { businessDate } from './business-date';

describe('businessDate', () => {
  it('conserva el día de Tampico aunque UTC ya sea el día siguiente', () => {
    // 2026-10-27 20:30 en Tampico (UTC-6) equivale a 2026-10-28 02:30 UTC.
    expect(businessDate(new Date('2026-10-28T02:30:00Z'))).toBe('2026-10-27');
  });

  it('cambia de día a la medianoche local', () => {
    expect(businessDate(new Date('2026-10-28T06:00:00Z'))).toBe('2026-10-28');
    expect(businessDate(new Date('2026-10-28T05:59:59Z'))).toBe('2026-10-27');
  });
});
