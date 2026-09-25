import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AlmacenService } from './almacen.service';

describe('AlmacenService', () => {
  it('captura un conteo pendiente sin modificar existencias', async () => {
    const queries: string[] = [];
    const manager = { query: jest.fn((sql: string) => {
      queries.push(sql);
      if (sql.includes('SELECT id_conteo')) return Promise.resolve([]);
      if (sql.includes('INSERT INTO conteo_inventario(')) return Promise.resolve([{ idConteo: 17 }]);
      if (sql.includes('SELECT cantidad FROM inventario_ubicacion')) return Promise.resolve([{ cantidad: '8' }]);
      return Promise.resolve([]);
    }) };
    const ds = { transaction: jest.fn((work: (m: typeof manager) => unknown) => work(manager)) } as unknown as DataSource;
    const service = new AlmacenService(ds);
    await expect(service.createCount({ requestId: '00000000-0000-4000-8000-000000000001', idUbicacion: 1, tipo: 'Ciclico', ciego: true, partidas: [{ idProducto: 2, cantidadContada: 7 }] }, 3)).resolves.toEqual({ idConteo: 17 });
    expect(queries.some(sql => sql.includes("'Pendiente'"))).toBe(true);
    expect(queries.some(sql => sql.includes('UPDATE producto'))).toBe(false);
  });

  it('impide resolver dos veces el mismo conteo', async () => {
    const manager = { query: jest.fn((sql: string) => sql.includes('SELECT estado') ? Promise.resolve([{ estado: 'Aplicado', idUbicacion: 1 }]) : Promise.resolve([])) };
    const ds = { transaction: jest.fn((work: (m: typeof manager) => unknown) => work(manager)) } as unknown as DataSource;
    await expect(new AlmacenService(ds).resolveCount(1, { aprobar: true }, 2)).rejects.toBeInstanceOf(ConflictException);
  });
});
