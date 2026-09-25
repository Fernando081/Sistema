import { PagoProveedorService } from './pago-proveedor.service';
import { MetodoPago } from '../common/enums/app.enums';

describe('PagoProveedorService', () => {
  it('registra pago proveedor y retorna id', async () => {
    const queryRunner = {
      connect: jest.fn(), startTransaction: jest.fn(), commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(), release: jest.fn(),
      query: jest.fn().mockImplementation((sql: string) => sql.includes('FROM compra')
        ? Promise.resolve([{ saldo_pendiente: 200, estatus: 'Pendiente' }])
        : Promise.resolve([{ id_pago: 12 }])),
    };
    const dataSourceMock = { createQueryRunner: () => queryRunner } as any;

    const service = new PagoProveedorService(dataSourceMock);
    const result = await service.registrarPago({
      idCompra: 2,
      monto: 120,
      formaPago: MetodoPago.TRANSFERENCIA,
      referencia: 'ABC',
      notas: '',
    });

    expect(result.idPago).toBe(12);
  });
});
