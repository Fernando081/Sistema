import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createHash } from 'node:crypto';
import {
  CreateCuentaTesoreriaDto,
  CreateMovimientoTesoreriaDto,
  ImportBankStatementDto,
} from './finanzas.dto';
import { queryRows } from '../common/database/typed-query';
import { parseBankStatementCsv } from './bank-statement.parser';

import { ConciliacionService } from './conciliacion.service';

@Injectable()
export class TesoreriaService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly conciliacion: ConciliacionService,
  ) {}

  async getCuentasTesoreria() {
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT c.id_cuenta AS "idCuenta",c.nombre,c.banco,c.moneda,
      c.ultimos_cuatro AS "ultimosCuatro",c.saldo_inicial AS "saldoInicial",c.activa,
      c.saldo_inicial+coalesce(sum(m.monto),0) AS saldo,
      count(m.id_movimiento) FILTER(WHERE m.estado='Pendiente')::int AS pendientes
      FROM tesoreria_cuenta c LEFT JOIN tesoreria_movimiento m ON m.id_cuenta=c.id_cuenta
      GROUP BY c.id_cuenta ORDER BY c.activa DESC,c.nombre`,
    );
  }

  async crearCuentaTesoreria(dto: CreateCuentaTesoreriaDto) {
    const rows = await queryRows<{ idCuenta: number }>(
      this.dataSource,
      `INSERT INTO tesoreria_cuenta(nombre,banco,moneda,ultimos_cuatro,saldo_inicial)
      VALUES($1,$2,$3,$4,$5) RETURNING id_cuenta AS "idCuenta"`,
      [
        dto.nombre,
        dto.banco,
        dto.moneda,
        dto.ultimosCuatro || null,
        dto.saldoInicial,
      ],
    );
    return {
      message: 'Cuenta de tesorería creada',
      idCuenta: rows[0].idCuenta,
    };
  }

  async getMovimientosTesoreria(idCuenta?: number) {
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT m.id_movimiento AS "idMovimiento",m.id_cuenta AS "idCuenta",
      c.nombre AS cuenta,c.banco,m.fecha,m.descripcion,m.referencia,m.monto,m.estado,m.metodo_conciliacion AS "metodoConciliacion",
      m.puntaje_conciliacion AS "puntajeConciliacion",m.observaciones,m.id_importacion AS "idImportacion",
      m.id_conciliacion AS "idConciliacion",m.conciliado_at AS "conciliadoAt",u.username AS "conciliadoPor"
      FROM tesoreria_movimiento m JOIN tesoreria_cuenta c ON c.id_cuenta=m.id_cuenta
      LEFT JOIN auth_user u ON u.id_user=m.conciliado_por
      WHERE ($1::int IS NULL OR m.id_cuenta=$1) ORDER BY m.fecha DESC,m.id_movimiento DESC LIMIT 500`,
      [idCuenta || null],
    );
  }

  async crearMovimientoTesoreria(dto: CreateMovimientoTesoreriaDto) {
    if (this.money(dto.monto) === 0)
      throw new BadRequestException(
        'El monto del movimiento no puede ser cero',
      );
    const rows = await queryRows<{ idMovimiento: number }>(
      this.dataSource,
      `INSERT INTO tesoreria_movimiento(id_cuenta,fecha,descripcion,referencia,monto)
      SELECT id_cuenta,$2,$3,$4,$5 FROM tesoreria_cuenta WHERE id_cuenta=$1 AND activa
      RETURNING id_movimiento AS "idMovimiento"`,
      [
        dto.idCuenta,
        dto.fecha,
        dto.descripcion,
        dto.referencia || null,
        dto.monto,
      ],
    );
    if (!rows.length)
      throw new NotFoundException(
        'Cuenta de tesorería no encontrada o inactiva',
      );
    return {
      message: 'Movimiento bancario importado',
      idMovimiento: rows[0].idMovimiento,
    };
  }

  async importarEstadoCuenta(
    dto: ImportBankStatementDto,
    file?: Express.Multer.File,
    idUsuario?: number,
  ) {
    if (!file) throw new BadRequestException('Selecciona un archivo CSV');
    if (
      ![
        'text/csv',
        'text/plain',
        'application/csv',
        'application/vnd.ms-excel',
        'application/octet-stream',
      ].includes(file.mimetype)
    ) {
      throw new BadRequestException(
        'El estado de cuenta debe ser un archivo CSV',
      );
    }
    const parsed = parseBankStatementCsv(file.buffer);
    if (!parsed.rows.length)
      throw new BadRequestException(
        'El archivo no contiene movimientos válidos',
      );
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtext('bank-import:'||$1))`,
        [dto.requestId],
      );
      const previous = await queryRows<{
        idImportacion: number;
        insertados: number;
        duplicados: number;
        conciliadosAuto: number;
      }>(
        manager,
        `SELECT id_importacion AS "idImportacion",insertados,duplicados,conciliados_auto AS "conciliadosAuto"
         FROM tesoreria_importacion WHERE request_id=$1 OR (id_cuenta=$2 AND sha256=$3) ORDER BY id_importacion LIMIT 1`,
        [dto.requestId, dto.idCuenta, sha256],
      );
      if (previous.length)
        return { ...previous[0], repeated: true, errores: parsed.errors };
      const account = await queryRows<{ id: number }>(
        manager,
        'SELECT id_cuenta AS id FROM tesoreria_cuenta WHERE id_cuenta=$1 AND activa FOR SHARE',
        [dto.idCuenta],
      );
      if (!account.length)
        throw new NotFoundException(
          'Cuenta de tesorería no encontrada o inactiva',
        );
      const imports = await queryRows<{ id: number }>(
        manager,
        `INSERT INTO tesoreria_importacion(request_id,id_cuenta,nombre_archivo,sha256,total_renglones,errores,id_user)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id_importacion AS id`,
        [
          dto.requestId,
          dto.idCuenta,
          file.originalname.slice(0, 255),
          sha256,
          parsed.rows.length + parsed.errors.length,
          JSON.stringify(parsed.errors.slice(0, 100)),
          idUsuario || null,
        ],
      );
      let inserted = 0,
        duplicates = 0,
        matched = 0;
      const occurrences = new Map<string, number>();
      for (const row of parsed.rows) {
        const signature = `${row.date}|${row.amount.toFixed(2)}|${(row.reference || '').toUpperCase()}|${row.description.toUpperCase()}`;
        const occurrence = (occurrences.get(signature) || 0) + 1;
        occurrences.set(signature, occurrence);
        const fingerprint = createHash('sha256')
          .update(`${dto.idCuenta}|${signature}|${occurrence}`)
          .digest('hex');
        const created = await queryRows<{ id: number }>(
          manager,
          `INSERT INTO tesoreria_movimiento(id_cuenta,fecha,descripcion,referencia,monto,id_importacion,fingerprint)
          VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id_movimiento AS id`,
          [
            dto.idCuenta,
            row.date,
            row.description,
            row.reference || null,
            row.amount,
            imports[0].id,
            fingerprint,
          ],
        );
        if (!created.length) {
          duplicates++;
          continue;
        }
        inserted++;
        if (dto.autoConciliar) {
          const candidates = await queryRows<{ id: number }>(
            manager,
            `SELECT cm.id_movimiento AS id FROM caja_movimiento cm
            WHERE cm.banco=$2::numeric AND cm.fecha::date BETWEEN $1::date-3 AND $1::date+3
              AND NOT EXISTS(SELECT 1 FROM tesoreria_conciliacion_sistema cs WHERE cs.id_caja_movimiento=cm.id_movimiento AND cs.activo)
            ORDER BY abs(cm.fecha::date-$1::date),cm.id_movimiento FOR UPDATE OF cm`,
            [row.date, row.amount],
          );
          if (candidates.length === 1) {
            await this.conciliacion.crearConciliacionExacta(
              manager,
              created[0].id,
              candidates[0].id,
              idUsuario,
              'Automatica',
            );
            matched++;
          }
        }
      }
      await manager.query(
        `UPDATE tesoreria_importacion SET insertados=$2,duplicados=$3,conciliados_auto=$4 WHERE id_importacion=$1`,
        [imports[0].id, inserted, duplicates, matched],
      );
      return {
        idImportacion: imports[0].id,
        insertados: inserted,
        duplicados: duplicates,
        conciliadosAuto: matched,
        errores: parsed.errors,
      };
    });
  }

  getImportaciones(idCuenta?: number) {
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT i.id_importacion AS "idImportacion",i.id_cuenta AS "idCuenta",c.nombre AS cuenta,
      i.nombre_archivo AS "nombreArchivo",i.total_renglones AS "totalRenglones",i.insertados,i.duplicados,
      i.conciliados_auto AS "conciliadosAuto",jsonb_array_length(i.errores) AS errores,i.created_at AS "createdAt",u.username AS usuario
      FROM tesoreria_importacion i JOIN tesoreria_cuenta c ON c.id_cuenta=i.id_cuenta LEFT JOIN auth_user u ON u.id_user=i.id_user
      WHERE($1::int IS NULL OR i.id_cuenta=$1) ORDER BY i.created_at DESC LIMIT 100`,
      [idCuenta || null],
    );
  }

  private money(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
