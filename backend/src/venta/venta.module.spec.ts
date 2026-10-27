import { Test } from '@nestjs/testing';
import { Provider } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { VentaModule } from './venta.module';
import { VentaService } from './venta.service';
import { FiscalService } from '../fiscal/fiscal.service';

describe('Composición de ventas por dominio', () => {
  async function fixture(cancelled: boolean) {
    const runner = { connect: jest.fn(), startTransaction: jest.fn(), commitTransaction: jest.fn(), rollbackTransaction: jest.fn(), release: jest.fn(), query: jest.fn().mockResolvedValue([{ id_devolucion: '12' }]) };
    const createQueryRunner = jest.fn(() => runner);
    const cancel = jest.fn().mockResolvedValue({ fiscal: true, cancelled, state: cancelled ? 'Cancelado' : 'Pendiente' });
    const providers = Reflect.getMetadata('providers', VentaModule) as Provider[];
    const module = await Test.createTestingModule({ providers: [
      ...providers,
      { provide: getDataSourceToken(), useValue: { createQueryRunner } },
      { provide: FiscalService, useValue: { cancel } },
    ] }).compile();
    return { module, runner, createQueryRunner, cancel, service: module.get(VentaService) };
  }

  it('no inicia reversión local mientras la cancelación fiscal siga pendiente', async () => {
    const { module, service, createQueryRunner, cancel } = await fixture(false);
    try {
      await expect(service.cancelarFactura(4, 9, { motivo: '02' })).resolves.toMatchObject({ cancelled: false, state: 'Pendiente' });
      expect(cancel).toHaveBeenCalledWith('FACTURA', 4, { motivo: '02' }, 9);
      expect(createQueryRunner).not.toHaveBeenCalled();
    } finally { await module.close(); }
  });

  it('conserva el bloqueo de origen y la reversión local tras confirmar cancelación', async () => {
    const { module, service, runner } = await fixture(true);
    try {
      await expect(service.cancelarFactura(4, 9)).resolves.toMatchObject({ cancelled: true });
      expect(runner.query).toHaveBeenNthCalledWith(1, expect.stringContaining('FOR UPDATE'), [4]);
      expect(runner.query).toHaveBeenNthCalledWith(2, 'CALL sp_cancelar_factura($1, $2)', [4, 9]);
      expect(runner.commitTransaction).toHaveBeenCalledTimes(1);
      expect(runner.rollbackTransaction).not.toHaveBeenCalled();
      expect(runner.release).toHaveBeenCalledTimes(1);
    } finally { await module.close(); }
  });

  it('revierte y libera la transacción cuando falla la devolución parcial', async () => {
    const { module, service, runner } = await fixture(true);
    const failure = new Error('Devolución excede cantidad');
    runner.query.mockRejectedValueOnce(failure);
    try {
      await expect(service.procesarDevolucion(4, { metodoReembolso: 'Efectivo', articulos: [{ idProducto: 2, cantidad: 1 }] }, 9)).rejects.toBe(failure);
      expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(runner.commitTransaction).not.toHaveBeenCalled();
      expect(runner.release).toHaveBeenCalledTimes(1);
    } finally { await module.close(); }
  });
});
