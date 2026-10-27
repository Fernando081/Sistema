import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DataSource } from 'typeorm';
import { ProductoService } from './producto.service';
import { ProductoExportDto } from './producto-export.dto';

describe('Listado y exportación de productos', () => {
  it('comparte filtros, protege el orden y escapa comodines', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ count: '1' }]).mockResolvedValueOnce([]);
    const service = new ProductoService({ query } as unknown as DataSource);
    await service.findAll(2, 10, '__proto__', 'desc', '100%_');
    expect(query.mock.calls[1][1]).toEqual(['100%_', '100\\%\\_', 10, 10]);
    expect(query.mock.calls[1][0]).toContain('ORDER BY "IdProducto" DESC');
    expect(query.mock.calls[0][0]).toContain('"CategoriaNombre"');
    expect(query.mock.calls[0][0]).toContain("regexp_replace($1, '[^[:alnum:]]', '', 'g') <> ''");
  });

  it('exporta todas las coincidencias con el mismo filtro y orden', async () => {
    const query = jest.fn().mockResolvedValue([{ IdProducto: 1, Codigo: '=CMD', Descripcion: 'Filtro,"A"', PrecioUnitario: '850.00', Existencia: 0 }]);
    const service = new ProductoService({ query } as unknown as DataSource);
    const csv = await service.exportCsv('codigo', 'asc', 'Filtro');
    expect(query.mock.calls[0][0]).toContain('ORDER BY "Codigo" ASC');
    expect(query.mock.calls[0][0]).toContain('LIMIT 5001');
    expect(query.mock.calls[0][1]).toEqual(['Filtro', 'Filtro']);
    expect(csv).toContain('"\'=CMD"'); expect(csv).toContain('"Filtro,""A"""');
    expect(csv).toContain('"850.00","0"');
  });

  it('rechaza exceso de filas sin exportación incompleta', async () => {
    const query = jest.fn().mockResolvedValue(Array.from({ length: 5001 }, () => ({ IdProducto: 1 })));
    await expect(new ProductoService({ query } as unknown as DataSource).exportCsv()).rejects.toThrow('5000 registros');
  });

  it('valida filtro, columna y dirección de exportación', () => {
    for (const values of [{ term: 'x'.repeat(201) }, { sort: '__proto__' }, { order: 'DROP TABLE' }]) {
      expect(validateSync(plainToInstance(ProductoExportDto, values)).length).toBeGreaterThan(0);
    }
  });
});
