import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreateGarantiaDto, UpdateGarantiaDto } from './garantia.dto';
import { queryRows } from '../common/database/typed-query';

interface GarantiaOrigenRow {
  id_concepto: number;
  cantidad: string | number;
  estatus: string;
  tipo_comprobante: string;
  tiene_devolucion: boolean;
  tiene_nota: boolean;
}

interface GarantiaRow {
  estado: string;
  resolucion: string | null;
  id_proveedor: number | null;
  destino_producto: string;
  evidencias: unknown;
  [column: string]: unknown;
}

@Injectable()
export class GarantiaService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  findAll() {
    return queryRows<Record<string, unknown>>(this.dataSource, `
      SELECT g.id_garantia AS "idGarantia", g.id_factura AS "idFactura",
             g.id_concepto AS "idConcepto", g.id_proveedor AS "idProveedor",
             g.estado, g.motivo, g.resolucion, g.cantidad,
             g.destino_producto AS "destinoProducto", g.evidencias,
             g.fecha_compromiso AS "fechaCompromiso",
             g.created_at AS "createdAt", g.updated_at AS "updatedAt",
             CONCAT(f.serie, '-', f.folio) AS factura,
             c."RazonSocial" AS cliente, p."Codigo" AS codigo,
             cf.descripcion AS producto, pr."RazonSocial" AS proveedor,
             u.username AS responsable
        FROM garantia g
        JOIN factura f ON f.id_factura = g.id_factura
        JOIN cliente c ON c."IdCliente" = f.id_cliente
        JOIN conceptofactura cf ON cf.id_concepto = g.id_concepto
        LEFT JOIN producto p ON p."IdProducto" = cf.id_producto
        LEFT JOIN proveedor pr ON pr."IdProveedor" = g.id_proveedor
        LEFT JOIN auth_user u ON u.id_user = g.id_user
       ORDER BY CASE WHEN g.estado = 'Cerrada' THEN 1 ELSE 0 END, g.updated_at DESC
    `);
  }

  async create(dto: CreateGarantiaDto, idUser?: number) {
    if (!dto.motivo.trim()) throw new BadRequestException('El motivo de la garantía es obligatorio');
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query("SELECT set_config('app.current_user_id', $1, true)", [idUser?.toString() || '']);
      const rows = await queryRows<GarantiaOrigenRow>(runner, `
        SELECT cf.id_concepto, cf.cantidad, f.estatus::text AS estatus, f.tipo_comprobante,
          EXISTS (SELECT 1 FROM devolucion d JOIN devolucion_detalle dd ON dd.id_devolucion=d.id_devolucion
            WHERE d.id_factura=f.id_factura AND dd.id_producto=cf.id_producto) AS tiene_devolucion,
          EXISTS (SELECT 1 FROM factura nf JOIN conceptofactura nc ON nc.id_factura=nf.id_factura
            WHERE nf.id_factura_origen=f.id_factura AND nf.estatus::text <> 'Cancelada'
              AND nc.id_producto=cf.id_producto) AS tiene_nota
          FROM conceptofactura cf
          JOIN factura f ON f.id_factura = cf.id_factura
         WHERE cf.id_concepto = $1 AND cf.id_factura = $2
         FOR UPDATE OF cf, f
      `, [dto.idConcepto, dto.idFactura]);
      if (!rows.length) throw new NotFoundException('El renglón no pertenece a la factura indicada');
      if (rows[0].estatus === 'Cancelada') throw new BadRequestException('No se admite garantía sobre una factura cancelada');
      if (rows[0].tipo_comprobante !== 'I') throw new BadRequestException('La garantía requiere una factura de ingreso');
      if (rows[0].tiene_devolucion || rows[0].tiene_nota) {
        throw new BadRequestException('El producto tiene devoluciones registradas; concilia las piezas antes de abrir su garantía');
      }

      const used = await queryRows<{ cantidad: string | number }>(runner, `
        SELECT COALESCE(SUM(cantidad), 0) AS cantidad
          FROM garantia
         WHERE id_concepto = $1 AND estado NOT IN ('Rechazada', 'Cerrada')
      `, [dto.idConcepto]);
      if (Number(used[0].cantidad) + dto.cantidad > Number(rows[0].cantidad)) {
        throw new BadRequestException('La cantidad en garantías abiertas excede la cantidad vendida');
      }

      const inserted = await queryRows<{ idGarantia: number }>(runner, `
        INSERT INTO garantia (
          id_factura, id_concepto, id_proveedor, cantidad, motivo,
          destino_producto, evidencias, id_user, fecha_compromiso
        ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,coalesce($9::timestamptz,clock_timestamp()+interval '7 days'))
        RETURNING id_garantia AS "idGarantia"
      `, [dto.idFactura, dto.idConcepto, dto.idProveedor || null, dto.cantidad,
        dto.motivo.trim(), dto.destinoProducto, JSON.stringify(dto.evidencias || []), idUser || null, dto.fechaCompromiso || null]);
      await runner.commitTransaction();
      return inserted[0];
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }

  async update(id: number, dto: UpdateGarantiaDto, idUser?: number) {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query("SELECT set_config('app.current_user_id', $1, true)", [idUser?.toString() || '']);
      const rows = await queryRows<GarantiaRow>(runner,
        'SELECT * FROM garantia WHERE id_garantia=$1 FOR UPDATE', [id],
      );
      if (!rows.length) throw new NotFoundException('Garantía no encontrada');
      const current = rows[0];
      if (dto.estado && dto.estado !== current.estado) this.validateTransition(current.estado, dto.estado);
      const estado = dto.estado ?? current.estado;
      const resolucion = dto.resolucion ?? current.resolucion;
      if (estado === 'Cerrada' && !resolucion?.trim()) {
        throw new BadRequestException('Indica la resolución antes de cerrar la garantía');
      }
      await runner.query(`
        UPDATE garantia SET estado=$2, resolucion=$3, id_proveedor=$4,
          destino_producto=$5, evidencias=$6::jsonb, fecha_compromiso=coalesce($7::timestamptz,fecha_compromiso), updated_at=now()
         WHERE id_garantia=$1
      `, [id, estado, resolucion || null, dto.idProveedor ?? current.id_proveedor,
        dto.destinoProducto ?? current.destino_producto,
        JSON.stringify(dto.evidencias ?? current.evidencias), dto.fechaCompromiso || null]);
      await runner.commitTransaction();
      return { message: 'Garantía actualizada' };
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }

  private validateTransition(from: string, to: string) {
    const allowed: Record<string, string[]> = {
      Recibida: ['En revision', 'Rechazada'],
      'En revision': ['Enviada proveedor', 'Aprobada', 'Rechazada'],
      'Enviada proveedor': ['Aprobada', 'Rechazada'],
      Aprobada: ['Cerrada'],
      Rechazada: ['Cerrada'],
      Cerrada: [],
    };
    if (!allowed[from]?.includes(to)) {
      throw new BadRequestException(`No se puede cambiar una garantía de ${from} a ${to}`);
    }
  }
}
