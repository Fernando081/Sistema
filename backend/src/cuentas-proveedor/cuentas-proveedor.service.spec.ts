import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CuentasProveedorService } from './cuentas-proveedor.service';

describe('CuentasProveedorService', () => {
  it('rechaza totales que no coinciden antes de crear la cuenta por pagar', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('factura_proveedor WHERE request_id')) return [];
      if (sql.includes('FROM orden_compra WHERE')) return [{ idProveedor: 2, estado: 'Recibida', moneda: 'MXN', tipoCambio: 1 }];
      if (sql.includes('FROM orden_compra_detalle')) return [{ idDetalle: 8, idProducto: 10, cantidad: 2, costo: 100, tasaIva: .16 }];
      return [];
    });
    const source = { transaction: (callback: (manager: { query: typeof query }) => unknown) => callback({ query }) } as unknown as DataSource;
    const service = new CuentasProveedorService(source);
    await expect(service.createInvoice({
      requestId:'00000000-0000-4000-8000-000000000001',idProveedor:2,idOrden:3,folio:'F-1',
      fechaEmision:'2026-09-26',fechaVencimiento:'2026-10-26',moneda:'MXN',tipoCambio:1,
      subtotal:200,impuestos:1,retenciones:0,total:201,
      partidas:[{idOrdenDetalle:8,descripcion:'Filtro',cantidad:2,costoUnitario:100,tasaIva:.16}],
    },1)).rejects.toBeInstanceOf(BadRequestException);
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO factura_proveedor('))).toBe(false);
  });

  it('rechaza un pago superior al saldo sin insertar movimientos', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('factura_proveedor_pago WHERE request_id')) return [];
      if (sql.includes('FROM factura_proveedor WHERE')) return [{ idFactura: 4, idProveedor: 2, saldo: 50, total: 100, estado: 'Aprobada', tipoCambio: 1 }];
      return [];
    });
    const source = { transaction: (callback: (manager: { query: typeof query }) => unknown) => callback({ query }) } as unknown as DataSource;
    const service = new CuentasProveedorService(source);
    await expect(service.pay(4,{requestId:'00000000-0000-4000-8000-000000000002',fecha:'2026-09-26',monto:50.01,formaPago:'Transferencia'},1))
      .rejects.toThrow('supera el saldo');
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO factura_proveedor_pago('))).toBe(false);
  });

  it('valida la firma y cierre del PDF antes de resguardarlo', async () => {
    const source = { query: jest.fn() } as unknown as DataSource;
    const service = new CuentasProveedorService(source);
    await expect(service.uploadPdf(1,{mimetype:'application/pdf',buffer:Buffer.from('archivo inválido')} as Express.Multer.File))
      .rejects.toThrow('PDF válido');
  });
});
