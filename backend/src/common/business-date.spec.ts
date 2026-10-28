import { businessDate, businessDateTime } from './business-date';

describe('business-date', () => {
  it('conserva el día de Tampico cuando UTC ya cambió de fecha', () => {
    // 20:30 del 27/10 en Tampico (UTC-6) = 02:30 del 28/10 UTC.
    expect(businessDate(new Date('2026-10-28T02:30:00Z'))).toBe('2026-10-27');
    expect(businessDateTime(new Date('2026-10-28T02:30:00Z'))).toBe(
      '2026-10-27T20:30:00',
    );
  });

  it('acepta cadenas ISO como las que devuelve PostgreSQL', () => {
    expect(businessDateTime('2026-01-15T18:05:09.123Z')).toBe(
      '2026-01-15T12:05:09',
    );
  });
});
