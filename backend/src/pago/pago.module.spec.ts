import { Test } from '@nestjs/testing';
import { Provider } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { PagoModule } from './pago.module';
import { PagoService } from './pago.service';
import { FiscalService } from '../fiscal/fiscal.service';

describe('Composición de cobranza y REP', () => {
  async function fixture() {
    const runner = { connect: jest.fn(), startTransaction: jest.fn(), commitTransaction: jest.fn(), rollbackTransaction: jest.fn(), release: jest.fn(), query: jest.fn().mockResolvedValue([]) };
    const query = jest.fn();
    const createQueryRunner = jest.fn(() => runner);
    const cancel = jest.fn().mockResolvedValue({ fiscal: true, cancelled: false, state: 'Pendiente' });
    const previewXml = jest.fn().mockResolvedValue('<cfdi:Comprobante/>');
    const providers = Reflect.getMetadata('providers', PagoModule) as Provider[];
    const module = await Test.createTestingModule({ providers: [
      ...providers,
      { provide: getDataSourceToken(), useValue: { createQueryRunner, query } },
      { provide: FiscalService, useValue: { cancel, previewXml } },
    ] }).compile();
    return { module, runner, query, createQueryRunner, cancel, previewXml, service: module.get(PagoService) };
  }

  it('conserva los saldos mientras SAT no confirme la cancelación del REP', async () => {
    const { module, service, cancel, createQueryRunner } = await fixture();
    try {
      await expect(service.cancelarRep(7, { motivo: '02' }, 9)).resolves.toMatchObject({ cancelled: false, state: 'Pendiente' });
      expect(cancel).toHaveBeenCalledWith('REP', 7, { motivo: '02' }, 9);
      expect(createQueryRunner).not.toHaveBeenCalled();
    } finally { await module.close(); }
  });

  it('usa el constructor fiscal de XML cuando el proveedor está registrado', async () => {
    const { module, service, previewXml, query } = await fixture();
    try {
      await expect(service.generarRepXml(7)).resolves.toBe('<cfdi:Comprobante/>');
      expect(previewXml).toHaveBeenCalledWith('REP', 7);
      expect(query).not.toHaveBeenCalled();
    } finally { await module.close(); }
  });

  it('revierte todo el REP si una segunda factura pertenece a otro cliente', async () => {
    const { module, service, runner } = await fixture();
    runner.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('INSERT INTO rep (')) return [{ id_rep: 7 }];
      if (sql.includes('FOR UPDATE OF f')) return [{ saldo_pendiente: 100, id_cliente: params?.[0] === 2 ? 1 : 99, estatus: 'Pendiente', moneda: 'MXN', metodo_clave: 'PPD', nueva_parcialidad: 1 }];
      return [];
    });
    try {
      await expect(service.registrarRepComplejo({ idCliente: 1, fechaPago: '2026-09-29', moneda: 'MXN', formaPago: 'Efectivo', montoTotal: 100, facturas: [{ idFactura: 9, montoSaldado: 50 }, { idFactura: 2, montoSaldado: 50 }] })).rejects.toThrow('no pertenece al cliente');
      const locks = runner.query.mock.calls.filter(([sql]) => sql.includes('FOR UPDATE OF f'));
      expect(locks.map(([, params]) => params?.[0])).toEqual([2, 9]);
      expect(runner.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO pago'), expect.arrayContaining([2, 7]));
      expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(runner.commitTransaction).not.toHaveBeenCalled();
      expect(runner.release).toHaveBeenCalledTimes(1);
    } finally { await module.close(); }
  });
});
