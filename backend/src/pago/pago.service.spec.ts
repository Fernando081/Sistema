import { BadRequestException } from '@nestjs/common';
import { PagoService } from './pago.service';
import { MetodoPago } from '../common/enums/app.enums';

describe('PagoService', () => {
  it('registra pago y retorna id', async () => {
    const dataSourceMock = {
      query: jest.fn().mockResolvedValue([{ id_pago: 7 }]),
    } as any;

    const service = new PagoService(dataSourceMock);
    const result = await service.registrarPago({
      idFactura: 1,
      monto: 55,
      formaPago: MetodoPago.EFECTIVO,
      referencia: '',
      notas: '',
    });

    expect(result.idPago).toBe(7);
  });

  it('lanza BadRequestException si falla query', async () => {
    const dataSourceMock = {
      query: jest.fn().mockRejectedValue(new Error('boom')),
    } as any;

    const service = new PagoService(dataSourceMock);
    await expect(
      service.registrarPago({
        idFactura: 1,
        monto: 1,
        formaPago: MetodoPago.EFECTIVO,
      } as any),
    ).rejects.toThrow(BadRequestException);
  });
});
