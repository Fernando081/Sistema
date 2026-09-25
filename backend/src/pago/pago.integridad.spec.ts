import { PagoService } from './pago.service';

const runnerFor = (handler: (sql: string, params?: any[]) => any) => ({
  connect: jest.fn(), startTransaction: jest.fn(), commitTransaction: jest.fn(),
  rollbackTransaction: jest.fn(), release: jest.fn(), query: jest.fn(async (sql: string, params?: any[]) => handler(sql, params)),
});
describe('Cobros: saldos y reversos', () => {
  it('rechaza un sobrepago de un centavo', async () => {
    const runner = runnerFor(() => [{ saldo_pendiente: '10.00', estatus: 'Pendiente' }]);
    const service = new PagoService({ createQueryRunner: () => runner } as any);
    await expect(service.registrarPago({ idFactura: 1, monto: 10.01, formaPago: 'Efectivo' })).rejects.toThrow('supera');
    expect(runner.rollbackTransaction).toHaveBeenCalled();
  });
  it('REP bloquea facturas en orden estable y registra vínculo explícito de pago', async () => {
    const runner = runnerFor((sql) => {
      if (sql.includes('INSERT INTO rep (')) return [{ id_rep: 7 }];
      if (sql.includes('SELECT f.saldo_pendiente')) return [{ saldo_pendiente: 100, id_cliente: 1, estatus: 'Pendiente', moneda: 'MXN', metodo_clave: 'PPD', nueva_parcialidad: 1 }];
      return [];
    });
    await new PagoService({ createQueryRunner: () => runner } as any).registrarRepComplejo({
      idCliente: 1, fechaPago: '2026-09-16', moneda: 'MXN', formaPago: 'Efectivo', montoTotal: 150,
      facturas: [{ idFactura: 9, montoSaldado: 100 }, { idFactura: 2, montoSaldado: 50 }],
    });
    const locks = runner.query.mock.calls.filter(([sql]) => sql.includes('FOR UPDATE OF f'));
    expect(locks.map(([, params]) => params![0])).toEqual([2, 9]);
    const payments = runner.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO pago'));
    expect(payments.every(([, params]) => params![6] === 7)).toBe(true);
  });
  it('cancelar REP elimina solo pagos vinculados y restaura el estado pendiente', async () => {
    const runner = runnerFor((sql) => {
      if (sql.includes('SELECT estado FROM rep')) return [{ estado: 'Activo' }];
      if (sql.includes('FROM rep_factura rf JOIN factura')) return [{ id_factura: 1, monto_pagado: 50, saldo_pendiente: 0, total: 100, estatus: 'Pagada' }];
      return [];
    });
    await new PagoService({ createQueryRunner: () => runner } as any).cancelarRep(7);
    expect(runner.query).toHaveBeenCalledWith('DELETE FROM pago WHERE id_rep = $1', [7]);
    expect(runner.query.mock.calls.some(([sql]) => sql.includes("estatus='Pendiente'"))).toBe(true);
  });
  it('bloquea cancelación REP después de reembolsar la factura', async () => {
    const runner = runnerFor((sql) => sql.includes('SELECT estado FROM rep') ? [{ estado: 'Activo' }] :
      sql.includes('FROM rep_factura rf JOIN factura') ? [{ tiene_devolucion: true }] : []);
    await expect(new PagoService({ createQueryRunner: () => runner } as any).cancelarRep(7)).rejects.toThrow('Concilia');
    expect(runner.rollbackTransaction).toHaveBeenCalled();
  });
  it('escapa los datos del receptor y cuenta en XML', async () => {
    const query = jest.fn(async (sql: string) => sql.includes('SELECT r.*') ? [{ id_rep: 1,
      cliente_nombre: 'Taller & "Diesel" <test>', cliente_rfc: 'AAA010101AAA', moneda: 'MXN',
      fecha_emision: '2026-09-16', fecha_pago: '2026-09-16', cuenta_beneficiario: '"/><evil/>',
    }] : []);
    const xml = await new PagoService({ query } as any).generarRepXml(1);
    expect(xml).toContain('Taller &amp; &quot;Diesel&quot; &lt;test&gt;');
    expect(xml).not.toContain('<evil/>');
  });
});
