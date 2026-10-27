import { Test } from '@nestjs/testing';
import { Provider } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { CuentasProveedorModule } from './cuentas-proveedor.module';
import { CuentasProveedorService } from './cuentas-proveedor.service';
import { createHash } from 'node:crypto';

describe('Composición de cuentas de proveedores', () => {
  async function createModule(query: jest.Mock) {
    const directQuery = jest.fn();
    const transaction = jest.fn(async (work: (manager: unknown) => unknown) =>
      work({ query }),
    );
    const providers = Reflect.getMetadata(
      'providers',
      CuentasProveedorModule,
    ) as Provider[];
    const module = await Test.createTestingModule({
      providers: [
        ...providers,
        {
          provide: getDataSourceToken(),
          useValue: { query: directQuery, transaction },
        },
      ],
    }).compile();
    return {
      module,
      directQuery,
      transaction,
      service: module.get(CuentasProveedorService),
    };
  }

  it('paga con bloqueo y actualiza obligación y tesorería en una transacción', async () => {
    const query = jest.fn().mockResolvedValue([]);
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          idFactura: 4,
          saldo: '100.00',
          total: '100.00',
          estado: 'Aprobada',
          tipoCambio: '20.00',
        },
      ])
      .mockResolvedValueOnce([{ id: 8 }]);
    const { module, directQuery, transaction, service } =
      await createModule(query);
    try {
      await expect(
        service.pay(
          4,
          {
            requestId: '00000000-0000-4000-8000-000000000001',
            fecha: '2026-09-29',
            monto: 25,
            formaPago: 'Transferencia',
          },
          9,
        ),
      ).resolves.toEqual({ idPago: 8, saldo: 75 });
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(directQuery).not.toHaveBeenCalled();
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('FOR UPDATE'),
        [4],
      );
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE factura_proveedor SET saldo_pendiente'),
        [4, 75],
      );
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE saldos'),
        [500, 'Transferencia'],
      );
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO operation_idempotency'),
        expect.any(Array),
      );
    } finally {
      await module.close();
    }
  });

  it('un reintento de pago devuelve el identificador previo sin repetir movimientos', async () => {
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          idFacturaProveedor: 4,
          idProgramacion: null,
          fecha: '2026-09-29',
          monto: 25,
          formaPago: 'Transferencia',
          referencia: null,
          notas: null,
        }),
      )
      .digest('hex');
    const query = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          operation_type: 'supplier-payment',
          payload_hash: hash,
          response: { idPago: 8, saldo: 75 },
        },
      ]);
    const { module, service } = await createModule(query);
    try {
      await expect(
        service.pay(
          4,
          {
            requestId: '00000000-0000-4000-8000-000000000001',
            fecha: '2026-09-29',
            monto: 25,
            formaPago: 'Transferencia',
          },
          9,
        ),
      ).resolves.toEqual({ idPago: 8, saldo: 75 });
      expect(query).toHaveBeenCalledTimes(2);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('operation_idempotency WHERE request_id=$1'),
        ['00000000-0000-4000-8000-000000000001'],
      );
    } finally {
      await module.close();
    }
  });
});
