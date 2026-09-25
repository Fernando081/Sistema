import { VentaService } from './venta.service';

const dto = () => ({ idCliente: 1, idFacturaOrigen: 8, tipoComprobante: 'E', serie: 'NC',
  metodoReembolso: 'Efectivo', rfcReceptor: 'AAAA010101AAA', nombreReceptor: 'Cliente', cpReceptor: '89000',
  regimenReceptor: '616', usoCfdi: 'G03', idFormaPago: 1, idMetodoPago: 1, moneda: 'MXN', tipoCambio: 1,
  subtotal: 100, totalImpuestosTrasladados: 16, totalImpuestosRetenidos: 0, total: 116,
  cfdisRelacionados: [{ tipoRelacion: '01', uuidRelacionado: '00000000-0000-0000-0000-000000000000' }],
  conceptos: [{ idProducto: 2, cantidad: 1, valorUnitario: 100, importe: 100, descuento: 0,
    descripcion: 'Filtro', objetoImpuesto: '02', claveProdServ: '123', claveUnidad: 'H87', codigo: 'F',
    unidadDescripcion: 'Pieza', baseIva: 100, tasaIva: 0.16, importeIva: 16 }],
});
function fixture(overrides: Record<string, any> = {}) {
  const runner = { connect: jest.fn(), startTransaction: jest.fn(), commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(), release: jest.fn(), query: jest.fn(async (sql: string) => {
      if (sql.includes('FROM pedido_venta WHERE')) return [{ id_pedido: 12, id_cliente: 1, estado: overrides.pedidoEstado || 'Entregado' }];
      if (sql.includes('FROM pedido_venta_detalle')) return [{ id_producto: 2, cantidad: 1, valor_unitario: 100 }];
      if (sql.startsWith('SELECT * FROM factura')) return [{ id_factura: 8, id_cliente: 1,
        tipo_comprobante: 'I', estatus: 'Pagada', serie: 'A', saldo_pendiente: 0, moneda: 'MXN', ...overrides }];
      if (sql.includes('FROM producto')) return [{ id: 2, existencia: 1, disponible: overrides.disponible,
        pedido_reservado: overrides.pedido_reservado,
        objeto_impuesto: '02', tasa_iva: 0.16, retiene_isr: false }];
      if (sql.includes('FROM conceptofactura cf WHERE')) return [{ id_producto: 2, cantidad: 1, neto: 100, iva: 16, retencion: 0, devuelto: overrides.devuelto || 0 }];
      if (sql.includes('AS next_folio')) return [{ next_folio: 5 }];
      if (sql.includes('SELECT fn_crear_venta')) return [{ id_factura: 9 }];
      if (sql.includes('INSERT INTO gasto')) return [{ id_gasto: 7 }];
      return [];
    }) };
  return { runner, service: new VentaService({ createQueryRunner: () => runner } as any, {} as any) };
}
describe('Ventas y notas: integridad', () => {
  it('rechaza notas para factura de otro cliente', async () => {
    const { service, runner } = fixture({ id_cliente: 22 });
    await expect(service.create(dto() as any, 1)).rejects.toThrow('mismo cliente');
    expect(runner.rollbackTransaction).toHaveBeenCalled();
  });
  it('rechaza reembolso de una factura sin liquidar', async () => {
    const { service } = fixture({ saldo_pendiente: 20 });
    await expect(service.create(dto() as any, 1)).rejects.toThrow('Liquida');
  });
  it('rechaza volver a devolver un producto agotado en notas anteriores', async () => {
    const { service } = fixture({ devuelto: 1 });
    await expect(service.create(dto() as any, 1)).rejects.toThrow('cantidad pendiente');
  });
  it('retira el cobro automático PUE de la nota y vincula su reembolso al gasto exacto', async () => {
    const { service, runner } = fixture();
    expect(await service.create(dto() as any, 1)).toEqual({ message: 'Venta registrada con éxito', idFactura: 9 });
    expect(runner.query).toHaveBeenCalledWith('DELETE FROM pago WHERE id_factura=$1', [9]);
    expect(runner.query).toHaveBeenCalledWith('UPDATE factura SET id_gasto_reembolso=$2 WHERE id_factura=$1', [9, 7]);
    expect(runner.commitTransaction).toHaveBeenCalled();
  });
  it('no admite fabricar una global mediante POST venta', async () => {
    const { service } = fixture();
    await expect(service.create({ ...dto(), tipoComprobante: 'I', serie: 'G' } as any)).rejects.toThrow('no corresponden');
  });
  it('impide vender existencia física que ya está apartada', async () => {
    const { service } = fixture({ disponible: 0 });
    const ventaDirecta = { ...dto(), idFacturaOrigen: undefined, tipoComprobante: 'I', serie: 'A',
      metodoReembolso: undefined, cfdisRelacionados: undefined };
    await expect(service.create(ventaDirecta as any, 1)).rejects.toThrow('Disponible después de apartados: 0');
  });
  it('factura un pedido surtido, consume su reserva y cierra el pedido', async () => {
    const { service, runner } = fixture({ disponible: 0, pedido_reservado: 1 });
    const ventaPedido = { ...dto(), requestId: 'a79f9462-d2b9-4b0f-a509-ce31404cc521', idPedido: 12,
      idFacturaOrigen: undefined, tipoComprobante: 'I', serie: 'F', metodoReembolso: undefined, cfdisRelacionados: undefined };
    await expect(service.create(ventaPedido as any, 1)).resolves.toEqual({ message: 'Venta registrada con éxito', idFactura: 9 });
    expect(runner.query).toHaveBeenCalledWith(expect.stringContaining("estado='Consumida'"), [12]);
    expect(runner.query).toHaveBeenCalledWith(expect.stringContaining("estado='Facturado'"), [12]);
  });
});
