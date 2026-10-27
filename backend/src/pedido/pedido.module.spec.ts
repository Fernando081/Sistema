import { Test } from '@nestjs/testing';
import { Provider } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { PedidoModule } from './pedido.module';
import { PedidoService } from './pedido.service';

describe('Composición de pedidos por dominio', () => {
  async function fixture(query: jest.Mock) {
    const directQuery = jest.fn();
    const transaction = jest.fn(async (work: (manager: unknown) => unknown) => work({ query }));
    const providers = Reflect.getMetadata('providers', PedidoModule) as Provider[];
    const module = await Test.createTestingModule({ providers: [
      ...providers, { provide: getDataSourceToken(), useValue: { query: directQuery, transaction } },
    ] }).compile();
    return { module, directQuery, transaction, service: module.get(PedidoService) };
  }

  it('registra entrega, historial y lectura final con el mismo manager y bloqueo', async () => {
    const query = jest.fn().mockResolvedValue([]);
    query.mockResolvedValueOnce([{ idPedido: 10, estado: 'Surtido', version: 4 }]);
    query.mockImplementation(async (sql: string) => sql.includes('SELECT pv.*') ? [{ idPedido: 10, estado: 'Entregado' }] : []);
    const { module, service, directQuery, transaction } = await fixture(query);
    try {
      await expect(service.deliver(10, { recibidoPor: 'Encargado de patio' }, 9)).resolves.toMatchObject({ idPedido: 10, estado: 'Entregado', partidas: [] });
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(directQuery).not.toHaveBeenCalled();
      expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('FOR UPDATE'), [10]);
      expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO entrega_pedido'), [10, 'Encargado de patio', null, 9]);
      expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO pedido_estado_historial'), [10, 'Surtido', 'Entregado', 'Recibió: Encargado de patio', 9]);
    } finally { await module.close(); }
  });

  it('rechaza entregar un pedido parcialmente surtido antes de escribir movimientos', async () => {
    const query = jest.fn().mockResolvedValue([{ idPedido: 10, estado: 'Parcialmente surtido', version: 4 }]);
    const { module, service, directQuery } = await fixture(query);
    try {
      await expect(service.deliver(10, {}, 9)).rejects.toThrow();
      expect(query).toHaveBeenCalledTimes(1);
      expect(directQuery).not.toHaveBeenCalled();
    } finally { await module.close(); }
  });
});
