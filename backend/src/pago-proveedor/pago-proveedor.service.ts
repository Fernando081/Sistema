// backend/src/pago-proveedor/pago-proveedor.service.ts
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RegistrarPagoProveedorDto } from './pago-proveedor.dto';
import { queryRows } from '../common/database/typed-query';

@Injectable()
export class PagoProveedorService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async registrarPago(dto: RegistrarPagoProveedorDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const compra = await queryRows<{ saldo_pendiente: string | number; estatus: string }>(queryRunner,
        `SELECT saldo_pendiente, estatus::text AS estatus
           FROM compra WHERE id_compra = $1 FOR UPDATE`,
        [dto.idCompra],
      );
      if (!compra.length) throw new NotFoundException('Compra no encontrada');
      if (['Cancelada', 'Cancelado'].includes(compra[0].estatus)) {
        throw new BadRequestException('No se puede pagar una compra cancelada');
      }
      if (Math.round(dto.monto * 100) > Math.round(Number(compra[0].saldo_pendiente) * 100)) {
        throw new BadRequestException('El pago supera el saldo pendiente de la compra');
      }

      const result = await queryRows<{ id_pago: number }>(queryRunner,
        `SELECT fn_registrar_pago_proveedor($1, $2, $3, $4, $5) as id_pago`,
        [
          dto.idCompra,
          dto.monto,
          dto.formaPago,
          dto.referencia || '',
          dto.notas || '',
        ],
      );
      await queryRunner.commitTransaction();
      return {
        message: 'Pago a proveedor registrado',
        idPago: result[0].id_pago,
      };
    } catch (error: unknown) {
      await queryRunner.rollbackTransaction();
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async getPagosPorCompra(idCompra: number) {
    return queryRows<Record<string, unknown>>(this.dataSource,
      `SELECT * FROM pago_proveedor WHERE id_compra = $1 ORDER BY fecha_pago DESC`,
      [idCompra],
    );
  }

  // Buscar compras que debemos pagar (Deuda)
  async getDeudaPorProveedor(idProveedor: number) {
    return queryRows<Record<string, unknown>>(this.dataSource,
      `SELECT id_compra, c.id_proveedor, folio_factura_proveedor, fecha_compra, total, saldo_pendiente, p."RazonSocial" as proveedor_nombre
       FROM compra c
       JOIN proveedor p ON c.id_proveedor = p."IdProveedor"
       WHERE c.id_proveedor = $1 AND saldo_pendiente > 0 AND c.estatus::text NOT IN ('Cancelada','Cancelado')
       ORDER BY fecha_compra ASC`,
      [idProveedor],
    );
  }

  // Buscar TODA la deuda
  async getAllDeuda() {
    return queryRows<Record<string, unknown>>(this.dataSource,
      `SELECT id_compra, c.id_proveedor, folio_factura_proveedor, fecha_compra, total, saldo_pendiente, p."RazonSocial" as proveedor_nombre
       FROM compra c
       JOIN proveedor p ON c.id_proveedor = p."IdProveedor"
       WHERE saldo_pendiente > 0 AND c.estatus::text NOT IN ('Cancelada','Cancelado')
       ORDER BY fecha_compra ASC`
    );
  }
}
