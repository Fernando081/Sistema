import { DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { ClienteService } from './cliente.service';
import { ProveedorService } from '../proveedor/proveedor.service';
import { CategoriaService } from '../categoria/categoria.service';

describe('Ediciones parciales de catálogos preservan datos PostgreSQL', () => {
  let query: jest.Mock;
  let source: DataSource;
  const row = { RFC: 'AAA010101AAA', RazonSocial: 'Taller Diesel', Pais: 'México', IdEstado: 1,
    IdMunicipio: 2, Ciudad: 'Ciudad', Colonia: 'Centro', Calle: 'Principal', CodigoPostal: '01000',
    NumeroExterior: '1', NumeroInterior: null, Referencia: 'Esquina', IdMetodoDePago: 1,
    IdUsoCFDI: 2, IdFormaPago: 3, IdRegimenFiscal: 4, email: 'correo@example.com' };
  beforeEach(() => {
    query = jest.fn();
    source = { query, transaction: async (work: (manager: unknown) => unknown) => work({ query }) } as unknown as DataSource;
  });
  it('editar solo razón social no borra RFC, dirección ni correo del cliente', async () => {
    query.mockResolvedValueOnce([row]).mockResolvedValueOnce([{ ...row, RazonSocial: 'Nuevo taller' }]);
    await new ClienteService(source).update(5, { razonSocial: 'Nuevo taller' });
    const params = query.mock.calls[1][1];
    expect(params[1]).toBe(row.RFC);
    expect(params[2]).toBe('Nuevo taller');
    expect(params[9]).toBe(row.CodigoPostal);
    expect(params[17]).toBe(row.email);
    expect(query.mock.calls[0][0]).toContain('FOR UPDATE');
  });
  it('editar dirección de proveedor conserva RFC y régimen fiscal', async () => {
    query.mockResolvedValueOnce([row]).mockResolvedValueOnce([row]);
    await new ProveedorService(source).update(5, { calle: 'Nueva calle' });
    const params = query.mock.calls[1][1];
    expect(params[1]).toBe(row.RFC);
    expect(params[8]).toBe('Nueva calle');
    expect(params[16]).toBe(row.IdRegimenFiscal);
  });
  it('edición vacía de categoría conserva Descripcion con nombre SQL', async () => {
    query.mockResolvedValueOnce([{ Descripcion: 'Filtros' }]).mockResolvedValueOnce([{ Descripcion: 'Filtros' }]);
    await new CategoriaService(source).update(5, {});
    expect(query.mock.calls[1][1]).toEqual([5, 'Filtros']);
  });
  it.each([ClienteService, ProveedorService, CategoriaService])('no actualiza un registro inexistente (%p)', async (Service) => {
    query.mockResolvedValueOnce([]);
    await expect(new Service(source).update(999, {})).rejects.toBeInstanceOf(NotFoundException);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
