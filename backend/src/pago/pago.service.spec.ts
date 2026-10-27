import { CobranzaService } from './cobranza.service';
import { RegistroRepService } from './registro-rep.service';
import { RepPdfService } from './rep-pdf.service';
import { RepXmlService } from './rep-xml.service';
import { DataSource } from 'typeorm';
import { PagoService } from './pago.service';
import { MetodoPago } from '../common/enums/app.enums';

describe('PagoService', () => {
  it('registra pago y retorna id', async () => {
    const queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      query: jest
        .fn()
        .mockImplementation((sql: string) =>
          sql.includes('FROM factura')
            ? Promise.resolve([{ saldo_pendiente: 100, estatus: 'Pendiente' }])
            : Promise.resolve([{ id_pago: 7 }]),
        ),
    };
    const dataSourceMock = { createQueryRunner: () => queryRunner } as any;

    const service = createPagoService(dataSourceMock);
    const result = await service.registrarPago({
      idFactura: 1,
      monto: 55,
      formaPago: MetodoPago.EFECTIVO,
      referencia: '',
      notas: '',
    });

    expect(result.idPago).toBe(7);
  });

  it('revierte y deja errores de infraestructura al filtro global sin exponerlos como errores de usuario', async () => {
    const queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      query: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const dataSourceMock = { createQueryRunner: () => queryRunner } as any;

    const service = createPagoService(dataSourceMock);
    await expect(
      service.registrarPago({
        idFactura: 1,
        monto: 1,
        formaPago: MetodoPago.EFECTIVO,
      } as any),
    ).rejects.toThrow('boom');
    expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalled();
  });
});

function createPagoService(source: unknown): PagoService {
  const ds = source as DataSource;
  return new PagoService(
    new CobranzaService(ds),
    new RegistroRepService(ds),
    new RepPdfService(ds),
    new RepXmlService(ds),
  );
}
