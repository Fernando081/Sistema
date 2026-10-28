import { businessDate } from '../common/business-date';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  CloseTreasuryPeriodDto,
  CreateTreasuryTransferDto,
} from './finanzas.dto';
import { queryRows } from '../common/database/typed-query';

@Injectable()
export class TransferenciasCierresService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getTransferCandidates(idMovimiento: number) {
    const source = await queryRows<{
      fecha: string;
      monto: string | number;
      idCuenta: number;
    }>(
      this.dataSource,
      `SELECT fecha,monto,id_cuenta AS "idCuenta" FROM tesoreria_movimiento WHERE id_movimiento=$1 AND estado='Pendiente'`,
      [idMovimiento],
    );
    if (!source.length)
      throw new NotFoundException('Movimiento pendiente no encontrado');
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT m.id_movimiento AS "idMovimiento",m.id_cuenta AS "idCuenta",
      c.nombre AS cuenta,c.banco,m.fecha,m.descripcion,m.referencia,m.monto
      FROM tesoreria_movimiento m JOIN tesoreria_cuenta c ON c.id_cuenta=m.id_cuenta
      WHERE m.estado='Pendiente' AND m.id_cuenta<>$2 AND m.monto=-$3::numeric
        AND m.fecha BETWEEN $1::date-7 AND $1::date+7
      ORDER BY abs(m.fecha-$1::date),m.id_movimiento LIMIT 20`,
      [source[0].fecha, source[0].idCuenta, source[0].monto],
    );
  }

  async crearTransferencia(dto: CreateTreasuryTransferDto, idUsuario?: number) {
    const idSalida = Number(dto.idMovimientoSalida),
      idEntrada = Number(dto.idMovimientoEntrada);
    if (idSalida === idEntrada)
      throw new BadRequestException('Selecciona dos movimientos distintos');
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtext('treasury-transfer:'||$1))`,
        [dto.requestId],
      );
      const previous = await queryRows<{ idTransferencia: number }>(
        manager,
        `SELECT id_transferencia AS "idTransferencia" FROM tesoreria_transferencia WHERE request_id=$1`,
        [dto.requestId],
      );
      if (previous.length)
        return {
          message: 'Transferencia ya registrada',
          ...previous[0],
          repeated: true,
        };
      const rows = await queryRows<{
        id: number;
        idCuenta: number;
        monto: string | number;
      }>(
        manager,
        `SELECT id_movimiento AS id,id_cuenta AS "idCuenta",monto FROM tesoreria_movimiento
         WHERE id_movimiento=ANY($1::bigint[]) AND estado='Pendiente' ORDER BY id_movimiento FOR UPDATE`,
        [[idSalida, idEntrada]],
      );
      if (rows.length !== 2)
        throw new ConflictException(
          'Uno de los movimientos ya no está pendiente',
        );
      const output = rows.find((row) => Number(row.id) === idSalida)!;
      const input = rows.find((row) => Number(row.id) === idEntrada)!;
      if (
        output.idCuenta === input.idCuenta ||
        Number(output.monto) >= 0 ||
        Number(input.monto) <= 0 ||
        this.money(Number(output.monto) + Number(input.monto)) !== 0
      ) {
        throw new BadRequestException(
          'El traspaso debe tener salida y entrada iguales en cuentas distintas',
        );
      }
      const group = await queryRows<{ id: number }>(
        manager,
        `INSERT INTO tesoreria_conciliacion
        (request_id,tipo,total_banco,total_sistema,ajuste,motivo,id_usuario) VALUES($1,'Transferencia',0,0,0,$2,$3)
        RETURNING id_conciliacion AS id`,
        [
          dto.requestId,
          dto.referencia || 'Traspaso entre cuentas propias',
          idUsuario || null,
        ],
      );
      await manager.query(
        `UPDATE tesoreria_movimiento SET estado='Conciliado',id_conciliacion=$2,conciliado_por=$3,
        conciliado_at=clock_timestamp(),metodo_conciliacion='Manual',puntaje_conciliacion=100,updated_at=clock_timestamp()
        WHERE id_movimiento=ANY($1::bigint[])`,
        [[idSalida, idEntrada], group[0].id, idUsuario || null],
      );
      const transfer = await queryRows<{ idTransferencia: number }>(
        manager,
        `INSERT INTO tesoreria_transferencia
        (request_id,id_conciliacion,id_movimiento_salida,id_movimiento_entrada,referencia,id_usuario)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id_transferencia AS "idTransferencia"`,
        [
          dto.requestId,
          group[0].id,
          idSalida,
          idEntrada,
          dto.referencia || null,
          idUsuario || null,
        ],
      );
      return {
        message: 'Transferencia interna conciliada',
        ...transfer[0],
        idConciliacion: group[0].id,
      };
    });
  }

  getCierres() {
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT ci.id_cierre AS "idCierre",ci.id_cuenta AS "idCuenta",
      c.nombre AS cuenta,c.banco,ci.anio,ci.mes,ci.saldo_estado_cuenta AS "saldoEstadoCuenta",
      ci.saldo_calculado AS "saldoCalculado",ci.movimientos,ci.conciliados,ci.ignorados,
      ci.created_at AS "createdAt",u.username AS usuario
      FROM tesoreria_cierre ci JOIN tesoreria_cuenta c ON c.id_cuenta=ci.id_cuenta
      JOIN auth_user u ON u.id_user=ci.id_usuario ORDER BY ci.anio DESC,ci.mes DESC,c.nombre`,
    );
  }

  async cerrarTesoreria(dto: CloseTreasuryPeriodDto, idUsuario?: number) {
    if (!idUsuario)
      throw new BadRequestException(
        'Se requiere un usuario autenticado para cerrar tesorería',
      );
    const end = new Date(Date.UTC(dto.anio, dto.mes, 0));
    const endIso = end.toISOString().slice(0, 10);
    if (endIso >= businessDate())
      throw new BadRequestException(
        'No se puede cerrar un mes que aún no termina',
      );
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtext('treasury-close:'||$1))`,
        [dto.idCuenta],
      );
      const account = await queryRows<{ saldoInicial: string | number }>(
        manager,
        `SELECT saldo_inicial AS "saldoInicial" FROM tesoreria_cuenta WHERE id_cuenta=$1 AND activa FOR UPDATE`,
        [dto.idCuenta],
      );
      if (!account.length)
        throw new NotFoundException(
          'Cuenta de tesorería no encontrada o inactiva',
        );
      const existing = await queryRows<{ id: number }>(
        manager,
        `SELECT id_cierre AS id FROM tesoreria_cierre WHERE id_cuenta=$1 AND anio=$2 AND mes=$3`,
        [dto.idCuenta, dto.anio, dto.mes],
      );
      if (existing.length)
        throw new ConflictException('Ese mes ya está cerrado para la cuenta');
      const pending = await queryRows<{ total: number }>(
        manager,
        `SELECT count(*)::int AS total FROM tesoreria_movimiento
        WHERE id_cuenta=$1 AND fecha<=$2::date AND estado='Pendiente'`,
        [dto.idCuenta, endIso],
      );
      if (Number(pending[0]?.total) > 0)
        throw new BadRequestException(
          `Hay ${pending[0].total} movimientos pendientes hasta el cierre`,
        );
      const summary = await queryRows<{
        saldo: string | number;
        movimientos: number;
        conciliados: number;
        ignorados: number;
      }>(
        manager,
        `SELECT
        $3::numeric+coalesce(sum(monto) FILTER(WHERE fecha<=$2::date),0) AS saldo,
        count(*) FILTER(WHERE fecha BETWEEN make_date($4,$5,1) AND $2::date)::int AS movimientos,
        count(*) FILTER(WHERE fecha BETWEEN make_date($4,$5,1) AND $2::date AND estado='Conciliado')::int AS conciliados,
        count(*) FILTER(WHERE fecha BETWEEN make_date($4,$5,1) AND $2::date AND estado='Ignorado')::int AS ignorados
        FROM tesoreria_movimiento WHERE id_cuenta=$1`,
        [dto.idCuenta, endIso, account[0].saldoInicial, dto.anio, dto.mes],
      );
      const saldo = this.money(Number(summary[0].saldo));
      if (saldo !== this.money(dto.saldoEstadoCuenta))
        throw new BadRequestException(
          `El saldo calculado (${saldo.toFixed(2)}) no coincide con el estado de cuenta`,
        );
      const result = await queryRows<{ idCierre: number }>(
        manager,
        `INSERT INTO tesoreria_cierre
        (id_cuenta,anio,mes,saldo_estado_cuenta,saldo_calculado,movimientos,conciliados,ignorados,id_usuario)
        VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8) RETURNING id_cierre AS "idCierre"`,
        [
          dto.idCuenta,
          dto.anio,
          dto.mes,
          saldo,
          summary[0].movimientos,
          summary[0].conciliados,
          summary[0].ignorados,
          idUsuario,
        ],
      );
      return { message: 'Mes de tesorería cerrado', ...result[0], saldo };
    });
  }

  private money(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
