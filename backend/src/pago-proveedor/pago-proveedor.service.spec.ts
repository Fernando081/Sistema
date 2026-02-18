import { PagoProveedorService } from './pago-proveedor.service';

describe('PagoProveedorService', () => {
  it('registra pago proveedor y retorna id', async () => {
    const dataSourceMock = {
      query: jest.fn().mockResolvedValue([{ id_pago: 12 }]),
    } as any;

    const service = new PagoProveedorService(dataSourceMock);
    const result = await service.registrarPago({
      idCompra: 2,
      monto: 120,
      formaPago: 'Transferencia',
      referencia: 'ABC',
      notas: '',
    });

    expect(result.idPago).toBe(12);
  });
});
