import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { FacturaQueryDto, facturaPage, facturaCsv } from './factura-query';

describe('Listado y exportación de facturas', () => {
  it('estado comercial parametrizado se conserva en página y CSV', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ count: 0 }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const params = Object.assign(new FacturaQueryDto(), { estado: 'Cancelada', tipo: 'E' });
    await facturaPage({ query }, params); await facturaCsv({ query }, params);
    expect(query.mock.calls[0][1]).toEqual(['', 'E', 'Cancelada', '', '']);
    expect(query.mock.calls[2][1]).toEqual(['', 'E', 'Cancelada', '', '']);
    expect(query.mock.calls[0][0]).toContain('f.estatus::text=$3');
    expect(validateSync(plainToInstance(FacturaQueryDto, { estado: 'NoExiste' })).length).toBeGreaterThan(0);
  });
  it('valida fechas reales y orden del rango', () => {
    for (const values of [{ desde: '2026-02-30' }, { hasta: '2026-13-01' }, { desde: '2026-10-02', hasta: '2026-10-01' }, { desde: '2026-1-1' }]) {
      expect(validateSync(plainToInstance(FacturaQueryDto, values)).length).toBeGreaterThan(0);
    }
    expect(validateSync(plainToInstance(FacturaQueryDto, { desde: '2024-02-29', hasta: '2024-02-29' }))).toHaveLength(0);
  });
  it('comparte rango parametrizado inclusivo entre conteo y CSV', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ count: 0 }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const filters = Object.assign(new FacturaQueryDto(), { desde: '2026-09-30', hasta: '2026-10-01' });
    await facturaPage({ query }, filters); await facturaCsv({ query }, filters);
    expect(query.mock.calls[0][1]).toEqual(['', '', '', '2026-09-30', '2026-10-01']);
    expect(query.mock.calls[2][1]).toEqual(query.mock.calls[0][1]);
    expect(query.mock.calls[0][0]).toContain("INTERVAL '1 day'");
  });
  it('valida tipo, límites y orden', () => {
    for (const values of [{ tipo: 'SQL' }, { limit: 101 }, { page: 0 }, { sortBy: '__proto__' }, { sortOrder: 'SQL' }, { term: 'x'.repeat(201) }]) {
      expect(validateSync(plainToInstance(FacturaQueryDto, values)).length).toBeGreaterThan(0);
    }
  });
  it('parametriza término y tipo y ordena el conjunto completo', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ count: '21' }]).mockResolvedValueOnce([]);
    const result = await facturaPage({ query }, Object.assign(new FacturaQueryDto(), { term: "%_'", tipo: 'E', page: 2, sortBy: 'total', sortOrder: 'asc' }));
    expect(result.total).toBe(21); expect(query.mock.calls[1][1]).toEqual(["%_'", 'E', '', '', '', 10, 10]);
    expect(query.mock.calls[1][0]).toContain('ORDER BY f.total ASC, f.id_factura DESC');
    expect(query.mock.calls[0][0]).toContain('f.tipo_comprobante=$2');
  });
  it('exporta fechas, importes y estado fiscal con fórmulas neutralizadas', async () => {
    const query = jest.fn().mockResolvedValue([{ id_factura: 1, serie: 'A', folio: 2, fecha_emision: new Date('2026-10-01T12:00:00Z'), nombre_receptor: '=CMD', total: '100.50', estado_fiscal: 'Timbrado' }]);
    const csv = await facturaCsv({ query }, new FacturaQueryDto());
    expect(csv).toContain('2026-10-01T12:00:00.000Z'); expect(csv).toContain('"\'=CMD"'); expect(csv).toContain('Timbrado');
    expect(query.mock.calls[0][0]).toContain('LIMIT 5001');
  });
  it('rechaza exceso de exportación sin truncar', async () => {
    const query = jest.fn().mockResolvedValue(Array.from({ length: 5001 }, () => ({})));
    await expect(facturaCsv({ query }, new FacturaQueryDto())).rejects.toThrow('5000 registros');
  });
});
