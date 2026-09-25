import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PedidoService } from './pedido.service';

describe('PedidoService: reservas y backorders', () => {
  let query: jest.Mock;
  let directQuery: jest.Mock;
  let service: PedidoService;
  beforeEach(() => {
    query = jest.fn().mockResolvedValue([]);
    directQuery = jest.fn().mockResolvedValue([]);
    const source = { query: directQuery, transaction: async (work: (manager: unknown) => unknown) => work({ query }) };
    service = new PedidoService(source as unknown as DataSource);
  });

  it('reserva lo disponible y crea backorder por el faltante', async () => {
    query
      .mockResolvedValueOnce([{ idPedido: 10, estado: 'Borrador', version: 1 }])
      .mockResolvedValueOnce([{ idDetalle: 20, idProducto: 3, cantidad: 8, reservada: 0, surtida: 0, descripcion: 'Filtro' }])
      .mockResolvedValueOnce([{ existencia: 10 }])
      .mockResolvedValueOnce([{ total: 6 }])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ idPedido: 10, estado: 'En espera' }]).mockResolvedValueOnce([]);
    const result = await service.confirm(10, 4);
    const reserveCall = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO reserva_inventario'));
    const backorderCall = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO backorder_cliente'));
    expect(reserveCall[1][3]).toBe(4);
    expect(backorderCall[1][3]).toBe(4);
    expect(result).toMatchObject({ idPedido: 10, estado: 'En espera', partidas: [] });
  });

  it('crea un solo pedido desde una cotización y agrupa el mismo producto', async () => {
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ idCliente: 7, folio: 88, estado: 'Vigente' }])
      .mockResolvedValueOnce([
        { idProducto: 3, descripcion: 'Filtro', cantidad: 2, valorUnitario: 100, tasa: 0.16, objeto: '02' },
        { idProducto: 3, descripcion: 'Filtro', cantidad: 1, valorUnitario: 130, tasa: 0.16, objeto: '02' },
      ])
      .mockResolvedValueOnce([{ idPedido: 15 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await expect(service.createFromQuote(88, { requestId: '8af1e23e-df2e-4ea9-9cd5-71d95de77b0d' }, 4))
      .resolves.toEqual({ idPedido: 15 });
    const detailInsert = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO pedido_venta_detalle'));
    expect(detailInsert[1][3]).toBe(3);
    expect(detailInsert[1][6]).toBe(330);
    expect(detailInsert[1][7]).toBe(52.8);
  });

  it('impide confirmar dos veces el mismo pedido', async () => {
    query.mockResolvedValueOnce([{ idPedido: 10, estado: 'Confirmado', version: 2 }]);
    await expect(service.confirm(10, 4)).rejects.toBeInstanceOf(ConflictException);
  });

  it('impide surtir más de la cantidad reservada', async () => {
    query.mockResolvedValueOnce([{ idPedido: 10, estado: 'Confirmado', version: 2 }])
      .mockResolvedValueOnce([{ idDetalle: 20, idProducto: 3, cantidad: 8, reservada: 4, surtida: 1, descripcion: 'Filtro' }]);
    await expect(service.fulfill(10, { partidas: [{ idDetalle: 20, cantidad: 4 }] }, 4)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('mantiene el pedido parcialmente surtido mientras exista un backorder', async () => {
    query
      .mockResolvedValueOnce([{ idPedido: 10, estado: 'En espera', version: 2 }])
      .mockResolvedValueOnce([{ idDetalle: 20, idProducto: 3, cantidad: 8, reservada: 4, surtida: 0, descripcion: 'Filtro' }])
      .mockResolvedValueOnce([{ idUbicacion: 1, disponible: 10 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ reservedPending: 0, backorderPending: 4 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ idPedido: 10, estado: 'Parcialmente surtido' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await service.fulfill(10, { partidas: [{ idDetalle: 20, cantidad: 4 }] }, 4);

    const stateUpdate = query.mock.calls.find(([sql]) => sql.includes('UPDATE pedido_venta SET estado'));
    expect(stateUpdate[1][1]).toBe('Parcialmente surtido');
    expect(result).toMatchObject({ idPedido: 10, estado: 'Parcialmente surtido' });
  });

  it('solo registra la entrega después de completar el surtido', async () => {
    query
      .mockResolvedValueOnce([{ idPedido: 10, estado: 'Surtido', version: 4 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ idPedido: 10, estado: 'Entregado' }])
      .mockResolvedValueOnce([]);
    await expect(service.deliver(10, { recibidoPor: 'Encargado de patio' }, 4))
      .resolves.toMatchObject({ idPedido: 10, estado: 'Entregado' });
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO entrega_pedido'))).toBe(true);
  });

  it('calcula existencia disponible descontando reservas activas', async () => {
    directQuery.mockResolvedValueOnce([{ existencia: 12, reservada: 5 }]);
    await expect(service.availability(3)).resolves.toEqual({ existenciaFisica: 12, reservada: 5, disponible: 7 });
  });

  it('prepara la factura del pedido con importes calculados en backend', async () => {
    directQuery
      .mockResolvedValueOnce([{
        id_pedido: 10,
        estado: 'Surtido',
        id_cliente: 7,
        rfc: 'XAXX010101000',
        nombre: 'Cliente de prueba',
        cp: '89000',
        idFormaPago: 1,
        idMetodoPago: 1,
        regimen: '616',
        uso: 'G03',
      }])
      .mockResolvedValueOnce([{
        idProducto: 3,
        cantidad: 2,
        valorUnitario: 100,
        descripcion: 'Filtro',
        codigo: 'FIL-001',
        objeto: '02',
        tasa: 0.16,
        retiene: false,
        claveProdServ: '26101700',
        claveUnidad: 'H87',
        unidad: 'Pieza',
      }]);

    const result = await service.prepareInvoice(10, {
      requestId: '8af1e23e-df2e-4ea9-9cd5-71d95de77b0d',
    });

    expect(result).toMatchObject({
      idPedido: 10,
      idCliente: 7,
      subtotal: 200,
      totalImpuestosTrasladados: 32,
      totalImpuestosRetenidos: 0,
      total: 232,
      serie: 'F',
    });
    expect(result.conceptos).toHaveLength(1);
    expect(result.conceptos[0]).toMatchObject({ idProducto: 3, cantidad: 2, importe: 200, importeIva: 32 });
  });

  it('libera apartados vencidos y conserva la demanda como backorder', async () => {
    query
      .mockResolvedValueOnce([{ idReserva: 30, idPedido: 10, idDetalle: 20, cantidadPendiente: 2 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ idPedido: 10, estado: 'Confirmado', version: 2 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await expect(service.releaseExpiredReservations(4)).resolves.toEqual({
      reservasLiberadas: 1,
      pedidosAfectados: 1,
    });
    expect(query.mock.calls.some(([sql]) => sql.includes("estado='Liberada'"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO backorder_cliente'))).toBe(true);
    const stateUpdate = query.mock.calls.find(([sql]) => sql.includes('UPDATE pedido_venta SET estado'));
    expect(stateUpdate[1][1]).toBe('En espera');
  });
});
