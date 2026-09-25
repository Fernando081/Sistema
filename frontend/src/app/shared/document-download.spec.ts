import { localDate, roundMoney } from './document-download';

describe('Operational date and money helpers', () => {
  it('uses the calendar date chosen by the operator, without a UTC conversion', () => {
    expect(localDate(new Date(2026, 8, 16, 23, 45))).toBe('2026-09-16');
  });
  it('rounds individual monetary amounts and binary floating point artifacts', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(4.99 * 0.16)).toBe(0.8);
  });
});
