import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CompraQueryDto, compraPage, compraCsv } from './compra-query';
describe('Listado y CSV de compras', () => {
  it('valida estado y rango real de fechas', () => {
    for (const value of [{ estado: 'NoExiste' }, { desde: '2026-02-30' }, { desde: '2026-10-02', hasta: '2026-10-01' }]) {
      expect(validateSync(plainToInstance(CompraQueryDto, value)).length).toBeGreaterThan(0);
    }
  });
  it('CSV y conteo conservan estado y fechas parametrizados', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const values = Object.assign(new CompraQueryDto(), { estado: 'Pendiente', desde: '2026-10-01', hasta: '2026-10-01' });
    await compraPage({ query }, values); await compraCsv({ query }, values);
    expect(query.mock.calls[0][1]).toEqual(['', 'Pendiente', '2026-10-01', '2026-10-01']);
    expect(query.mock.calls[2][1]).toEqual(query.mock.calls[0][1]);
    expect(query.mock.calls[0][0]).toContain("AT TIME ZONE 'America/Mexico_City'");
  });
  it('valida límites y columnas permitidas', () => {
    for (const value of [{ limit: 101 }, { page: 0 }, { sortBy: '__proto__' }, { sortOrder: 'SQL' }, { term: 'x'.repeat(201) }]) {
      expect(validateSync(plainToInstance(CompraQueryDto, value)).length).toBeGreaterThan(0);
    }
  });
  it('parametriza búsqueda literal y pagina/ordena con desempate', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ total: '21' }]).mockResolvedValueOnce([]);
    const page = await compraPage({ query }, Object.assign(new CompraQueryDto(), { term: '%_', page: 2, sortBy: 'total', sortOrder: 'asc' }));
    expect(page.total).toBe(21); expect(query.mock.calls[1][1]).toEqual(['%_', '', '', '', 10, 10]);
    expect(query.mock.calls[1][0]).toContain('ORDER BY c.total ASC, c.id_compra DESC');
    expect(query.mock.calls[0][0]).toContain('strpos');
  });
  it('CSV conserva fechas/importes y protege fórmulas', async () => {
    const query = jest.fn().mockResolvedValue([{ id_compra: 1, fecha_compra: new Date('2026-10-01T12:00:00Z'), nombre_proveedor: '=CMD', total: '100.50' }]);
    const csv = await compraCsv({ query }, new CompraQueryDto());
    expect(csv).toContain('2026-10-01T12:00:00.000Z'); expect(csv).toContain('"\'=CMD"'); expect(csv).toContain('100.50');
    expect(query.mock.calls[0][0]).toContain('LIMIT 5001');
  });
  it('rechaza exceso sin truncamiento', async () => {
    const query = jest.fn().mockResolvedValue(Array.from({ length: 5001 }, () => ({})));
    await expect(compraCsv({ query }, new CompraQueryDto())).rejects.toThrow('5000 registros');
  });
});
