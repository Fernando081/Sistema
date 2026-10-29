import { CancellationFollowUp, followUpDelayMinutes } from '../fiscal/fiscal.service';
import { MockFiscalProvider } from '../fiscal/providers/mock-fiscal.provider';
import { SeguimientoFiscalService } from './seguimiento-fiscal.service';

describe('Seguimiento de cancelaciones fiscales (O01.2c)', () => {
  const seguimiento = (result: CancellationFollowUp['result'], extra: Partial<CancellationFollowUp> = {}): CancellationFollowUp =>
    ({ type: 'FACTURA', originId: 40, documentId: 9, userId: 3, result, consultas: 1, ...extra });

  function crear(result: CancellationFollowUp | null, estadoOrigen = 'Timbrada') {
    const queries: string[] = [];
    const db = {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        if (sql.includes('RETURNING id_documento')) return Promise.resolve([{ id_documento: 9 }]);
        if (sql.includes('FROM factura')) return Promise.resolve([{ estatus: estadoOrigen }]);
        if (sql.includes('FROM rep')) return Promise.resolve([{ estado: estadoOrigen }]);
        return Promise.resolve([]);
      }),
    };
    const fiscal = { markInterruptedStamps: jest.fn().mockResolvedValue(0), followUpCancellation: jest.fn().mockResolvedValue(result) };
    const ventas = { cancelarFactura: jest.fn().mockResolvedValue({}) };
    const reps = { cancelarRep: jest.fn().mockResolvedValue({}) };
    const service = new SeguimientoFiscalService(db as never, fiscal as never, ventas as never, reps as never);
    const avisos = () => queries.filter((q) => q.includes('INSERT INTO app_notification'));
    return { service, ventas, reps, db, avisos };
  }

  it('espera 15 min, 1 h, 4 h y luego cada 12 h', () => {
    expect([1, 2, 3, 4, 20].map(followUpDelayMinutes)).toEqual([15, 60, 240, 720, 720]);
  });

  it('al confirmar el SAT completa la reversión con el usuario que la pidió y avisa', async () => {
    const { service, ventas, db } = crear(seguimiento('Cancelado'));
    await expect(service.procesar()).resolves.toMatchObject({ consultados: 1, cancelados: 1, revertidos: 1 });
    expect(ventas.cancelarFactura).toHaveBeenCalledWith(40, 3);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO app_notification'), expect.arrayContaining(['info', '/facturas']));
  });

  it('no repite una reversión hecha a mano y usa el flujo de REP para recibos', async () => {
    const hecha = crear(seguimiento('Cancelado'), 'Cancelada');
    await hecha.service.procesar();
    expect(hecha.ventas.cancelarFactura).not.toHaveBeenCalled();
    const rep = crear(seguimiento('Cancelado', { type: 'REP', userId: null }));
    await rep.service.procesar();
    expect(rep.reps.cancelarRep).toHaveBeenCalledWith(40, {}, undefined);
  });

  it('un rechazo sólo avisa; una reversión fallida avisa como crítica', async () => {
    const rechazo = crear(seguimiento('Rechazada'));
    await expect(rechazo.service.procesar()).resolves.toMatchObject({ rechazados: 1, revertidos: 0 });
    expect(rechazo.ventas.cancelarFactura).not.toHaveBeenCalled();
    expect(rechazo.avisos()).toHaveLength(1);
    const falla = crear(seguimiento('Cancelado'));
    falla.ventas.cancelarFactura.mockRejectedValue(new Error('bloqueo'));
    await expect(falla.service.procesar()).resolves.toMatchObject({ cancelados: 1, fallidos: 1 });
    expect(falla.db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO app_notification'), expect.arrayContaining(['critical']));
  });

  it('el proveedor mock puede dejar cancelaciones pendientes o rechazadas', async () => {
    const input = { uuid: 'u', issuerRfc: 'A', receiverRfc: 'B', total: 1, cfdiSeal: '', reason: '02' as const };
    await expect(new MockFiscalProvider().cancel(input)).resolves.toMatchObject({ cancelled: true });
    await expect(new MockFiscalProvider('pendiente').cancel(input)).resolves.toMatchObject({ accepted: true, cancelled: false });
    await expect(new MockFiscalProvider('pendiente').queryStatus()).resolves.toMatchObject({ status: 'Cancelado' });
    await expect(new MockFiscalProvider('rechazada').queryStatus()).resolves.toMatchObject({ status: 'Vigente', cancellationStatus: 'Solicitud rechazada' });
  });
});
