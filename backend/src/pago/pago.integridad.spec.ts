import { CobranzaService } from './cobranza.service';
import { RegistroRepService } from './registro-rep.service';
import { RepPdfService } from './rep-pdf.service';
import { RepXmlService } from './rep-xml.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { DataSource } from 'typeorm';
import { PagoService } from './pago.service';

const runnerFor = (handler: (sql: string, params?: any[]) => any) => ({
  connect: jest.fn(),
  startTransaction: jest.fn(),
  commitTransaction: jest.fn(),
  rollbackTransaction: jest.fn(),
  release: jest.fn(),
  query: jest.fn(async (sql: string, params?: any[]) => handler(sql, params)),
});
describe('Cobros: saldos y reversos', () => {
  it('rechaza un sobrepago de un centavo', async () => {
    const runner = runnerFor(() => [
      { saldo_pendiente: '10.00', estatus: 'Pendiente' },
    ]);
    const service = createPagoService({
      createQueryRunner: () => runner,
    } as any);
    await expect(
      service.registrarPago({
        idFactura: 1,
        monto: 10.01,
        formaPago: 'Efectivo',
      }),
    ).rejects.toThrow('supera');
    expect(runner.rollbackTransaction).toHaveBeenCalled();
  });
  it('REP bloquea facturas en orden estable y registra vínculo explícito de pago', async () => {
    const runner = runnerFor((sql) => {
      if (sql.includes('INSERT INTO rep (')) return [{ id_rep: 7 }];
      if (sql.includes('SELECT f.saldo_pendiente'))
        return [
          {
            saldo_pendiente: 100,
            id_cliente: 1,
            estatus: 'Pendiente',
            moneda: 'MXN',
            metodo_clave: 'PPD',
            nueva_parcialidad: 1,
          },
        ];
      return [];
    });
    await createPagoService({
      createQueryRunner: () => runner,
    } as any).registrarRepComplejo({
      idCliente: 1,
      fechaPago: '2026-09-16',
      moneda: 'MXN',
      formaPago: 'Efectivo',
      montoTotal: 150,
      facturas: [
        { idFactura: 9, montoSaldado: 100 },
        { idFactura: 2, montoSaldado: 50 },
      ],
    });
    const locks = runner.query.mock.calls.filter(([sql]) =>
      sql.includes('FOR UPDATE OF f'),
    );
    expect(locks.map(([, params]) => params![0])).toEqual([2, 9]);
    const payments = runner.query.mock.calls.filter(([sql]) =>
      sql.includes('INSERT INTO pago'),
    );
    expect(payments.every(([, params]) => params![6] === 7)).toBe(true);
  });
  it('cancelar REP elimina solo pagos vinculados y restaura el estado pendiente', async () => {
    const runner = runnerFor((sql) => {
      if (sql.includes('SELECT estado FROM rep')) return [{ estado: 'Activo' }];
      if (sql.includes('FROM rep_factura rf JOIN factura'))
        return [
          {
            id_factura: 1,
            monto_pagado: 50,
            saldo_pendiente: 0,
            total: 100,
            estatus: 'Pagada',
          },
        ];
      return [];
    });
    await createPagoService({
      createQueryRunner: () => runner,
    } as any).cancelarRep(7);
    expect(runner.query).toHaveBeenCalledWith(
      'DELETE FROM pago WHERE id_rep = $1',
      [7],
    );
    expect(
      runner.query.mock.calls.some(([sql]) =>
        sql.includes("estatus='Pendiente'"),
      ),
    ).toBe(true);
  });
  it('bloquea cancelación REP después de reembolsar la factura', async () => {
    const runner = runnerFor((sql) =>
      sql.includes('SELECT estado FROM rep')
        ? [{ estado: 'Activo' }]
        : sql.includes('FROM rep_factura rf JOIN factura')
          ? [{ tiene_devolucion: true }]
          : [],
    );
    await expect(
      createPagoService({ createQueryRunner: () => runner } as any).cancelarRep(
        7,
      ),
    ).rejects.toThrow('Concilia');
    expect(runner.rollbackTransaction).toHaveBeenCalled();
  });
  it('descarga el XML del REP desde el generador fiscal único', async () => {
    const previewXml = jest.fn(async () => '<cfdi:Comprobante TipoDeComprobante="P"/>');
    const service = new PagoService(
      new CobranzaService({} as DataSource), new RegistroRepService({} as DataSource),
      new RepPdfService({} as DataSource), new RepXmlService({ previewXml } as unknown as FiscalService),
    );
    await expect(service.generarRepXml(7)).resolves.toContain('TipoDeComprobante="P"');
    expect(previewXml).toHaveBeenCalledWith('REP', 7);
  });
});

function createPagoService(source: unknown): PagoService {
  const ds = source as DataSource;
  return new PagoService(
    new CobranzaService(ds),
    new RegistroRepService(ds),
    new RepPdfService(ds),
    new RepXmlService({ previewXml: jest.fn(async () => '<cfdi:Comprobante/>') } as unknown as FiscalService),
  );
}
