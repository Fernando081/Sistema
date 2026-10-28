import { createHash } from 'node:crypto';
import { CompraService, COMPRA_CREDITO_DIAS } from './compra.service';

// H02-b · "Nueva compra" registra orden → recepción → factura aprobada (y pago si es de contado)
// en una sola transacción; ya no llama a fn_crear_compra ni crea saldo en compra.saldo_pendiente.
function setup() {
  const sql: string[] = [];
  const manager = {
    query: jest.fn().mockImplementation((text: string) => {
      sql.push(text);
      if (text.includes('FROM producto')) return Promise.resolve([{ IdProducto: 5 }, { IdProducto: 7 }]);
      if (text.includes('FROM orden_compra_detalle d JOIN orden_compra o')) {
        return Promise.resolve([
          { idDetalle: 11, idProducto: 5, descripcion: 'Filtro', cantidad: '2', costo: '50', folio: '120' },
          { idDetalle: 12, idProducto: 7, descripcion: 'Balero', cantidad: '1', costo: '30.5', folio: '120' },
        ]);
      }
      return Promise.resolve([]);
    }),
  };
  const dataSource = { transaction: jest.fn((work: (m: typeof manager) => unknown) => work(manager)) };
  const abastecimiento = {
    createOrderIn: jest.fn().mockResolvedValue({ idOrden: 40 }),
    receiveIn: jest.fn().mockResolvedValue({ idRecepcion: 41, estadoOrden: 'Recibida' }),
  };
  const facturas = {
    createInvoiceIn: jest.fn().mockResolvedValue({ idFacturaProveedor: 42, estado: 'Conciliada', discrepancias: 0 }),
    approveInvoiceIn: jest.fn().mockResolvedValue({ message: 'ok' }),
  };
  const pagos = { payIn: jest.fn().mockResolvedValue({ idPago: 43, saldo: 0 }) };
  const service = new CompraService(dataSource as never, abastecimiento as never, facturas as never, pagos as never);
  return { service, manager, sql, abastecimiento, facturas, pagos };
}

const base = {
  idProveedor: 3,
  folioFactura: 'A-1',
  observaciones: 'Entrega en mostrador',
  total: 130.5,
  conceptos: [
    { idProducto: 5, codigo: 'ABC', descripcion: 'Filtro', cantidad: 2, costoUnitario: 50, importe: 100 },
    { idProducto: 7, codigo: 'XYZ', descripcion: 'Balero', cantidad: 1, costoUnitario: 30.5, importe: 30.5 },
  ],
};

describe('CompraService (compra directa por flujo formal)', () => {
  it('contado: orden directa, recepción completa, factura aprobada y pago por el total', async () => {
    const { service, sql, abastecimiento, facturas, pagos } = setup();
    const result = await service.create({ ...base, esCredito: false, formaPago: 'Transferencia' }, 9);

    expect(abastecimiento.createOrderIn.mock.calls[0][2]).toBe(9);
    expect(abastecimiento.createOrderIn.mock.calls[0][3]).toBe('Compra directa');
    expect(abastecimiento.createOrderIn.mock.calls[0][1].partidas).toEqual([
      { idProducto: 5, cantidad: 2, costoUnitario: 50, tasaIva: 0 },
      { idProducto: 7, cantidad: 1, costoUnitario: 30.5, tasaIva: 0 },
    ]);
    expect(abastecimiento.receiveIn.mock.calls[0][1]).toBe(40);
    expect(abastecimiento.receiveIn.mock.calls[0][2].partidas).toEqual([{ idDetalle: 11, cantidad: 2 }, { idDetalle: 12, cantidad: 1 }]);
    const invoice = facturas.createInvoiceIn.mock.calls[0][1];
    expect(invoice).toEqual(expect.objectContaining({ idOrden: 40, folio: 'A-1', subtotal: 130.5, impuestos: 0, total: 130.5 }));
    expect(invoice.fechaVencimiento).toBe(invoice.fechaEmision);
    expect(facturas.approveInvoiceIn).toHaveBeenCalledWith(expect.anything(), 42, 9);
    expect(pagos.payIn.mock.calls[0][2]).toEqual(expect.objectContaining({ monto: 130.5, formaPago: 'Transferencia' }));
    expect(result).toEqual(expect.objectContaining({ idOrden: 40, folioOrden: '120', idRecepcion: 41, idFacturaProveedor: 42, idPago: 43 }));
    expect(sql.join('\n')).not.toContain('fn_crear_compra');
    expect(sql.join('\n')).not.toContain('pago_proveedor');
  });

  it('crédito: factura vence a 30 días, sin pago, y folio automático si no se captura', async () => {
    const { service, facturas, pagos } = setup();
    const result = await service.create({ ...base, folioFactura: '', esCredito: true });
    const invoice = facturas.createInvoiceIn.mock.calls[0][1];
    expect(invoice.folio).toBe('OC-120');
    const days = (Date.parse(invoice.fechaVencimiento) - Date.parse(invoice.fechaEmision)) / 86_400_000;
    expect(days).toBe(COMPRA_CREDITO_DIAS);
    expect(pagos.payIn).not.toHaveBeenCalled();
    expect(result.idPago).toBeNull();
  });

  it('rechaza total distinto al servidor, productos repetidos y facturas que no concilian', async () => {
    let ctx = setup();
    await expect(ctx.service.create({ ...base, total: 131, esCredito: true })).rejects.toThrow('El total de la compra no coincide');
    expect(ctx.abastecimiento.createOrderIn).not.toHaveBeenCalled();

    ctx = setup();
    await expect(ctx.service.create({ ...base, esCredito: true, conceptos: [base.conceptos[0], base.conceptos[0]], total: 200 }))
      .rejects.toThrow('Cada producto debe aparecer una sola vez');

    ctx = setup();
    ctx.facturas.createInvoiceIn.mockResolvedValue({ idFacturaProveedor: 42, estado: 'Con discrepancias', discrepancias: 1 });
    await expect(ctx.service.create({ ...base, esCredito: true })).rejects.toThrow('no concilió');
    expect(ctx.facturas.approveInvoiceIn).not.toHaveBeenCalled();
  });

  it('reintento con el mismo requestId devuelve la respuesta guardada; con datos distintos se rechaza', async () => {
    const { service, manager, abastecimiento } = setup();
    const requestId = '3f6c1f62-2a1b-4c5d-9e8f-0a1b2c3d4e5f';
    const payload = { ...base, esCredito: true };
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    manager.query.mockImplementation((text: string) =>
      Promise.resolve(text.includes('FROM operation_idempotency') ? [{ payload_hash: hash, response: { idOrden: 1 } }] : []));
    await expect(service.create({ ...payload, requestId })).resolves.toEqual({ idOrden: 1 });
    await expect(service.create({ ...payload, total: 99, requestId })).rejects.toThrow('ya fue usado con datos diferentes');
    expect(abastecimiento.createOrderIn).not.toHaveBeenCalled();
  });

  it('folio repetido del proveedor se informa como conflicto legible', async () => {
    const { service, facturas } = setup();
    facturas.createInvoiceIn.mockRejectedValue(Object.assign(new Error('duplicate'), { code: '23505' }));
    await expect(service.create({ ...base, esCredito: true })).rejects.toThrow('Ese folio de factura ya está registrado');
  });
});
