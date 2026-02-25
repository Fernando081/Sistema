// backend/src/pago-proveedor/pago-proveedor.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RegistrarPagoProveedorDto } from './pago-proveedor.dto';

@Injectable()
export class PagoProveedorService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async registrarPago(dto: RegistrarPagoProveedorDto) {
    try {
      const result = await this.dataSource.query(
        `SELECT fn_registrar_pago_proveedor($1, $2, $3, $4, $5) as id_pago`,
        [
          dto.idCompra,
          dto.monto,
          dto.formaPago,
          dto.referencia || '',
          dto.notas || '',
        ],
      );
      return {
        message: 'Pago a proveedor registrado',
        idPago: result[0].id_pago,
      };
    } catch (error: any) {
      throw new BadRequestException(error.message || 'Error al registrar pago');
    }
  }

  async getPagosPorCompra(idCompra: number) {
    return this.dataSource.query(
      `SELECT * FROM pago_proveedor WHERE id_compra = $1 ORDER BY fecha_pago DESC`,
      [idCompra],
    );
  }

  // Buscar compras que debemos pagar (Deuda)
  async getDeudaPorProveedor(idProveedor: number) {
    return this.dataSource.query(
      `SELECT id_compra, folio_factura_proveedor, fecha_compra, total, saldo_pendiente 
       FROM compra 
       WHERE id_proveedor = $1 AND saldo_pendiente > 0.01
       ORDER BY fecha_compra ASC`,
      [idProveedor],
    );
  }
}
