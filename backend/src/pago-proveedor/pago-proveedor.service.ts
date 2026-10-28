// backend/src/pago-proveedor/pago-proveedor.service.ts
import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RegistrarPagoProveedorDto } from './pago-proveedor.dto';
import { queryRows } from '../common/database/typed-query';
import { setAuditActor } from '../auth/audit-actor';

interface IdempotencyRow {
  response: Record<string, unknown>;
  payload_hash: string;
  operation_type: string;
}

export interface LegacySupplierDebtRow {
  id_compra: number;
  id_proveedor: number;
  folio_factura_proveedor: string | null;
  fecha_compra: Date | string;
  total: string | number;
  saldo_pendiente: string | number;
  proveedor_nombre: string;
}

@Injectable()
export class PagoProveedorService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async registrarPago(dto: RegistrarPagoProveedorDto, idUser?: number) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await setAuditActor(queryRunner, idUser);
      const { requestId, ...payload } = dto;
      const payloadHash = createHash('sha256')
        .update(JSON.stringify(payload))
        .digest('hex');
      if (requestId) {
        // Serializa reintentos del mismo UUID y devuelve la respuesta original.
        await queryRunner.query(
          `SELECT pg_advisory_xact_lock(hashtext('pago-proveedor-request:' || $1))`,
          [requestId],
        );
        const previous = await queryRows<IdempotencyRow>(
          queryRunner,
          `SELECT response, payload_hash, operation_type FROM operation_idempotency WHERE request_id = $1`,
          [requestId],
        );
        if (previous.length) {
          if (
            previous[0].operation_type !== 'pago_proveedor' ||
            previous[0].payload_hash !== payloadHash
          ) {
            throw new ConflictException(
              'El identificador de reintento ya fue usado con datos diferentes',
            );
          }
          await queryRunner.commitTransaction();
          return previous[0].response;
        }
      }

      const compra = await queryRows<{
        saldo_pendiente: string | number;
        estatus: string;
      }>(
        queryRunner,
        `SELECT saldo_pendiente, estatus::text AS estatus
           FROM compra WHERE id_compra = $1 FOR UPDATE`,
        [dto.idCompra],
      );
      if (!compra.length) throw new NotFoundException('Compra no encontrada');
      if (['Cancelada', 'Cancelado'].includes(compra[0].estatus)) {
        throw new BadRequestException('No se puede pagar una compra cancelada');
      }
      if (
        Math.round(dto.monto * 100) >
        Math.round(Number(compra[0].saldo_pendiente) * 100)
      ) {
        throw new BadRequestException(
          'El pago supera el saldo pendiente de la compra',
        );
      }

      const result = await queryRows<{ id_pago: number }>(
        queryRunner,
        `SELECT fn_registrar_pago_proveedor($1, $2, $3, $4, $5) as id_pago`,
        [
          dto.idCompra,
          dto.monto,
          dto.formaPago,
          dto.referencia || '',
          dto.notas || '',
        ],
      );
      const response = {
        message: 'Pago a proveedor registrado',
        idPago: result[0].id_pago,
      };
      if (requestId) {
        await queryRunner.query(
          `INSERT INTO operation_idempotency(request_id, operation_type, id_user, payload_hash, response)
           VALUES ($1, 'pago_proveedor', $2, $3, $4::jsonb)`,
          [requestId, idUser ?? null, payloadHash, JSON.stringify(response)],
        );
      }
      await queryRunner.commitTransaction();
      return response;
    } catch (error: unknown) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async getPagosPorCompra(idCompra: number) {
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT * FROM pago_proveedor WHERE id_compra = $1 ORDER BY fecha_pago DESC`,
      [idCompra],
    );
  }

  // Buscar compras que debemos pagar (Deuda)
  async getDeudaPorProveedor(idProveedor: number) {
    return queryRows<LegacySupplierDebtRow>(
      this.dataSource,
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
    return queryRows<LegacySupplierDebtRow>(
      this.dataSource,
      `SELECT id_compra, c.id_proveedor, folio_factura_proveedor, fecha_compra, total, saldo_pendiente, p."RazonSocial" as proveedor_nombre
       FROM compra c
       JOIN proveedor p ON c.id_proveedor = p."IdProveedor"
       WHERE saldo_pendiente > 0 AND c.estatus::text NOT IN ('Cancelada','Cancelado')
       ORDER BY fecha_compra ASC`,
    );
  }
}
