import { ConflictException } from '@nestjs/common';
import { consumeCommercialAuthorizations, validateCommercialPolicy } from './commercial-policy';

describe('Política comercial transaccional', () => {
  it('conserva el flujo histórico para clientes sin política configurada', async () => {
    const executor = { query: jest.fn().mockResolvedValue([]) };
    await expect(validateCommercialPolicy(executor, {
      idCliente: 7,
      lineas: [{ idProducto: 3, cantidad: 1, precio: 100 }],
    })).resolves.toEqual([]);
    expect(executor.query).toHaveBeenCalledTimes(1);
  });

  it('bloquea operaciones de un cliente suspendido', async () => {
    const executor = { query: jest.fn().mockResolvedValue([{
      bloqueado: true,
      motivoBloqueo: 'Saldo vencido',
      limite: 1000,
      deuda: 0,
      comprometido: 0,
      esCredito: false,
    }]) };
    await expect(validateCommercialPolicy(executor, { idCliente: 7 }))
      .rejects.toThrow('Saldo vencido');
  });

  it('exige autorización para margen bajo y la vincula una sola vez', async () => {
    const executor = { query: jest.fn(async (sql: string) => {
      if (sql.includes('WITH requested')) return [{
        idProducto: 3, precio: 70, sugerido: 100, costo: 80, margenMinimo: 0.2,
      }];
      if (sql.includes('FROM cliente_comercial')) return [{
        bloqueado: false, motivoBloqueo: null, limite: 1000, deuda: 0, comprometido: 0, esCredito: false,
      }];
      if (sql.includes('FROM solicitud_autorizacion_comercial')) return [{ id: 9 }];
      if (sql.includes('UPDATE solicitud_autorizacion_comercial')) return [{ id: 9 }];
      return [];
    }) };
    const ids = await validateCommercialPolicy(executor, {
      idCliente: 7,
      lineas: [{ idProducto: 3, cantidad: 2, precio: 70 }],
    });
    expect(ids).toEqual([9]);
    await expect(consumeCommercialAuthorizations(executor, ids, 'Venta', 22)).resolves.toBeUndefined();
    expect(executor.query).toHaveBeenCalledWith(expect.stringContaining("SET estado='Utilizada'"), [[9], 'Venta', 22]);
  });

  it('rechaza una autorización que fue consumida concurrentemente', async () => {
    const executor = { query: jest.fn().mockResolvedValue([]) };
    await expect(consumeCommercialAuthorizations(executor, [3], 'Pedido', 10))
      .rejects.toBeInstanceOf(ConflictException);
  });
});
