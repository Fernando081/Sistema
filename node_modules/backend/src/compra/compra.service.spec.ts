import { CompraService } from './compra.service';

describe('CompraService', () => {
  it('crea compra y retorna id', async () => {
    const dataSourceMock = {
      query: jest.fn().mockResolvedValue([{ id_compra: 99 }]),
    } as any;

    const service = new CompraService(dataSourceMock);
    const result = await service.create({
      idProveedor: 1,
      folioFactura: 'A-1',
      esCredito: false,
      total: 100,
      observaciones: '',
      conceptos: [],
    });

    expect(result.idCompra).toBe(99);
    expect(dataSourceMock.query).toHaveBeenCalled();
  });
});
