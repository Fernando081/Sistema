import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DirectoryQueryDto, directoryCsv, directoryPage } from './directory-query';

describe('Directorios remotos', () => {
  it('término selectivo conserva literalidad y parámetros de página', async () => {
    const query = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 1 }]).mockResolvedValueOnce([{ IdCliente: 5 }]);
    const result = await directoryPage({ query }, 'cliente', Object.assign(new DirectoryQueryDto(), { term: 'VIN_%', page: 2, limit: 25 }));
    expect(result.total).toBe(1);
    expect(query.mock.calls[0][1]).toEqual(['%VIN\\_\\%%']);
    expect(query.mock.calls[2][1]).toEqual(['%VIN\\_\\%%', 25, 25]);
  });
  it('sondeo amplio conserva el término literal en la ruta anterior', async () => {
    const query = jest.fn().mockResolvedValueOnce(Array.from({ length: 257 }, () => ({}))).mockResolvedValueOnce([{ total: 300 }]).mockResolvedValueOnce([{ IdProveedor: 1 }]);
    const result = await directoryPage({ query }, 'proveedor', Object.assign(new DirectoryQueryDto(), { term: 'Diesel' }));
    expect(result.total).toBe(300);
    expect(query.mock.calls[1][1]).toEqual(['Diesel']);
    expect(query.mock.calls[2][1]).toEqual(['Diesel', 10, 0]);
  });
  it.each([{ page: 0 }, { limit: 101 }, { sortBy: 'RFC; DROP TABLE cliente' }, { sortOrder: 'invalid' }])
    ('rechaza parámetros fuera del contrato: %j', values => {
      expect(validateSync(plainToInstance(DirectoryQueryDto, values)).length).toBeGreaterThan(0);
    });

  it('parametriza el término, pagina y limita el orden a columnas conocidas', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ total: '21' }]).mockResolvedValueOnce([{ IdCliente: 5 }]);
    const params = Object.assign(new DirectoryQueryDto(), { term: "%' OR 1=1 --", page: 3, sortBy: '__proto__' });
    const page = await directoryPage({ query }, 'cliente', params);
    expect(page.total).toBe(21);
    expect(query.mock.calls[1][1]).toEqual([params.term, 10, 20]);
    expect(query.mock.calls[1][0]).toContain('ORDER BY d."IdCliente" DESC');
    expect(query.mock.calls[1][0]).not.toContain(params.term);

  });

  it('CSV neutraliza fórmulas y conserva comillas, comas y saltos de línea', async () => {
    const query = jest.fn().mockResolvedValue([{ IdProveedor: 2, RFC: '+CMD', RazonSocial: 'Diesel,"A"\nTampico', CodigoPostal: '08900' }]);
    const csv = await directoryCsv({ query }, 'proveedor', new DirectoryQueryDto());
    expect(csv).toContain('"\'+CMD"');
    expect(csv).toContain('"Diesel,""A""\nTampico"');
    expect(csv.startsWith('\uFEFF')).toBe(true);
  });

  it('rechaza una exportación excedida en lugar de truncarla silenciosamente', async () => {
    const query = jest.fn().mockResolvedValue(Array.from({ length: 5001 }, () => ({ IdCliente: 1 })));
    await expect(directoryCsv({ query }, 'cliente', new DirectoryQueryDto())).rejects.toThrow('5000 registros');
  });
});
