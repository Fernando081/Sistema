import { CompraService } from './compra.service';

describe('CompraService', () => {
  it('crea compra y retorna id', async () => {
    const queryRunnerMock = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      query: jest.fn().mockResolvedValue([{ id_compra: 99 }]),
    };

    const dataSourceMock = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunnerMock),
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
    expect(queryRunnerMock.query).toHaveBeenCalled();
  });
});
