import { PagoProveedorService } from './pago-proveedor.service';
import { MetodoPago } from '../common/enums/app.enums';
import { createHash } from 'node:crypto';

describe('PagoProveedorService', () => {
  it('registra pago proveedor y retorna id', async () => {
    const queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      query: jest
        .fn()
        .mockImplementation((sql: string) =>
          sql.includes('FROM compra')
            ? Promise.resolve([{ saldo_pendiente: 200, estatus: 'Pendiente' }])
            : Promise.resolve([{ id_pago: 12 }]),
        ),
    };
    const dataSourceMock = { createQueryRunner: () => queryRunner } as any;

    const service = new PagoProveedorService(dataSourceMock);
    const result = await service.registrarPago({
      idCompra: 2,
      monto: 120,
      formaPago: MetodoPago.TRANSFERENCIA,
      referencia: 'ABC',
      notas: '',
    });

    expect(result.idPago).toBe(12);
  });

  it('devuelve la respuesta original ante un reintento con el mismo requestId', async () => {
    const original = { message: 'Pago a proveedor registrado', idPago: 7 };
    const requestId = '11111111-1111-4111-8111-111111111111';
    const dto = {
      requestId,
      idCompra: 2,
      monto: 50,
      formaPago: MetodoPago.EFECTIVO,
    };
    const payload = {
      idCompra: dto.idCompra,
      monto: dto.monto,
      formaPago: dto.formaPago,
    };
    const hash = createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
    const queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      query: jest.fn().mockImplementation((sql: string) =>
        sql.includes('FROM operation_idempotency')
          ? Promise.resolve([
              {
                response: original,
                payload_hash: hash,
                operation_type: 'pago_proveedor',
              },
            ])
          : Promise.resolve([]),
      ),
    };
    const service = new PagoProveedorService({
      createQueryRunner: () => queryRunner,
    } as any);
    await expect(service.registrarPago(dto, 3)).resolves.toEqual(original);
    expect(
      queryRunner.query.mock.calls.some(([sql]: [string]) =>
        sql.includes('fn_registrar_pago_proveedor'),
      ),
    ).toBe(false);
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
  });

  it('rechaza un requestId reutilizado con otro contenido', async () => {
    const queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      query: jest.fn().mockImplementation((sql: string) =>
        sql.includes('FROM operation_idempotency')
          ? Promise.resolve([
              {
                response: {},
                payload_hash: 'otro',
                operation_type: 'pago_proveedor',
              },
            ])
          : Promise.resolve([]),
      ),
    };
    const service = new PagoProveedorService({
      createQueryRunner: () => queryRunner,
    } as any);
    await expect(
      service.registrarPago(
        {
          requestId: '22222222-2222-4222-8222-222222222222',
          idCompra: 2,
          monto: 50,
          formaPago: 'Efectivo',
        },
        3,
      ),
    ).rejects.toThrow('datos diferentes');
    expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
  });
});
