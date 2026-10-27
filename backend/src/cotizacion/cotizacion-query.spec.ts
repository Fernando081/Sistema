import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CotizacionQueryDto, cotizacionPage, cotizacionCsv } from './cotizacion-query';

describe('Consultas de cotizaciones', () => {
  it('valida estado y rango real de fechas', () => {
    for (const value of [{ estado: 'NoExiste' }, { desde: '2026-02-30' }, { desde: '2026-10-02', hasta: '2026-10-01' }]) {
      expect(validateSync(plainToInstance(CotizacionQueryDto, value)).length).toBeGreaterThan(0);
    }
  });
  it('CSV y conteo conservan estado y fechas parametrizados', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const values = Object.assign(new CotizacionQueryDto(), { estado: 'Pendiente', desde: '2026-10-01', hasta: '2026-10-01' });
    await cotizacionPage({ query }, values); await cotizacionCsv({ query }, values);
    expect(query.mock.calls[0][1]).toEqual(['', 'Pendiente', '2026-10-01', '2026-10-01']);
    expect(query.mock.calls[2][1]).toEqual(query.mock.calls[0][1]);
    expect(query.mock.calls[0][0]).toContain("AT TIME ZONE 'America/Mexico_City'");
  });
  it('valida límites y columnas permitidas', () => {
    for (const value of [{ page: 0 }, { limit: 101 }, { term: 'x'.repeat(201) }, { sortBy: '__proto__' }, { sortOrder: 'SQL' }]) {
      expect(validateSync(plainToInstance(CotizacionQueryDto, value)).length).toBeGreaterThan(0);
    }
  });
  it('parametriza filtro literal, ordena y pagina sin multiplicar pedidos', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ total: '21' }]).mockResolvedValueOnce([]);
    const params = Object.assign(new CotizacionQueryDto(), { page: 2, term: "%_'", sortBy: 'total', sortOrder: 'asc' });
    const page = await cotizacionPage({ query }, params);
    expect(page.total).toBe(21);
    expect(query.mock.calls[1][1]).toEqual(["%_'", '', '', '', 10, 10]);
    expect(query.mock.calls[1][0]).toContain('ORDER BY f.total ASC, f.id_cotizacion DESC');
    expect(query.mock.calls[1][0]).toContain('ORDER BY pv.id_pedido DESC LIMIT 1');
  });
  it('CSV conserva fecha e importes y neutraliza fórmulas', async () => {
    const query = jest.fn().mockResolvedValue([{ id_cotizacion: 1, folio: 100, fecha_emision: new Date('2026-09-30T12:00:00Z'), nombre_receptor: '=CMD', total: '100.50', estatus: 'Vigente' }]);
    const csv = await cotizacionCsv({ query }, new CotizacionQueryDto());
    expect(csv).toContain('2026-09-30T12:00:00.000Z'); expect(csv).toContain('"\'=CMD"'); expect(csv).toContain('100.50');
    expect(query.mock.calls[0][0]).toContain('LIMIT 5001');
  });
  it('rechaza exportaciones incompletas por exceso de filas', async () => {
    const query = jest.fn().mockResolvedValue(Array.from({ length: 5001 }, () => ({})));
    await expect(cotizacionCsv({ query }, new CotizacionQueryDto())).rejects.toThrow('5000 registros');
  });
});
