import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CrmWebMetricsService, validateWebMetricsPeriod } from './crm-web-metrics.service';
import { QueryExecutor } from '../common/database/typed-query';

describe('Periodo y privacidad de medición web', () => {
  it('admite un día, bisiesto y hasta 366 días inclusivos', () => {
    expect(validateWebMetricsPeriod('2024-02-29', '2024-02-29')).toBe(1);
    expect(validateWebMetricsPeriod('2024-01-01', '2024-12-31')).toBe(366);
    expect(validateWebMetricsPeriod('2026-10-01', '2026-10-03')).toBe(3);
  });
  it('rechaza fechas inexistentes, formato/inyección, orden y rangos excesivos', () => {
    for (const [desde, hasta] of [['2025-02-29', '2025-03-01'], ['2026-04-31', '2026-05-01'],
      ['2026-13-01', '2026-13-02'], ['2026-1-01', '2026-10-01'], ["2026-10-01' OR TRUE", '2026-10-03'],
      ['2026-10-04', '2026-10-03'], ['2025-01-01', '2026-01-02'], ['1999-12-31', '2000-01-01']]) {
      expect(() => validateWebMetricsPeriod(desde, hasta)).toThrow(BadRequestException);
    }
  });
  it('consulta en snapshot READ ONLY parametrizado y sin inventar conversión de un periodo vacío', async () => {
    const source = { query: jest.fn().mockImplementation((sql: string) => Promise.resolve(sql.startsWith('WITH')
      ? [{ generatedAt: new Date('2026-10-12T03:00:00Z'), totals: { recibidas: 0, oportunidades: 0 }, daily: [], references: [] }] : [])) };
    const transaction = jest.fn().mockImplementation((_isolation: string, work: (manager: QueryExecutor) => Promise<unknown>) => work(source));
    const service = new CrmWebMetricsService({ transaction } as unknown as DataSource);
    const result = await service.report('2026-10-01', '2026-10-03');
    expect(transaction.mock.calls[0][0]).toBe('REPEATABLE READ');
    expect(source.query.mock.calls[0]).toEqual(['SET TRANSACTION READ ONLY']);
    expect(source.query.mock.calls[1]).toEqual(["SET LOCAL statement_timeout='5s'"]);
    expect(source.query.mock.calls[2][1].slice(0,2)).toEqual(['2026-10-01', '2026-10-03']);
    expect(source.query.mock.calls[2][1][2]).toEqual(expect.arrayContaining(['MXN','USD']));
    expect(source.query.mock.calls[2][1][2]).not.toContain('XXX');
    expect(source.query.mock.calls[2][1][2]).not.toContain('ZZZ');
    expect(result.generatedAt).toBe('2026-10-12T03:00:00.000Z');
    expect(result.conversionPct).toBeNull();
    expect(result.unmeasured).not.toContain('utilidadBruta');
    expect(result.unmeasured).toContain('flujoIntegral');
    expect(result.unmeasured).not.toContain('cobrosNetosRegistrados');
    expect(result.unmeasured).toContain('ventasSinVinculo');
    await expect(service.report('2026-04-31', '2026-05-01')).rejects.toThrow(BadRequestException);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
