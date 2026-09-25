import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ConteoCajaDto } from './caja.dto';
import { queryRows } from '../common/database/typed-query';

export interface SaldoCajaRow {
  id_saldo: number;
  caja_chica: string | number;
  cuenta_banco: string | number;
}

export interface TurnoCajaRow {
  id_turno: number;
  estado: string;
  id_movimiento_inicio: string | number;
  id_movimiento_fin: string | number | null;
  [column: string]: unknown;
}

export interface TotalesCajaRow {
  entradas: string | number;
  salidas: string | number;
}

export interface MovimientoCajaRow {
  total_rows: string | number;
  [column: string]: unknown;
}

@Injectable()
export class CajaService {
  constructor(private readonly db: DataSource) {}

  private async saldo(manager: EntityManager, lock = false): Promise<SaldoCajaRow> {
    const rows = await queryRows<SaldoCajaRow>(manager, `SELECT id_saldo,caja_chica,cuenta_banco FROM saldos ORDER BY id_saldo${lock ? ' FOR UPDATE' : ''}`);
    if (rows.length !== 1) throw new ConflictException('Configura una sola caja general en saldos antes de operar turnos');
    return rows[0];
  }

  resumen() {
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      const saldo = await this.saldo(manager);
      const [turno] = await queryRows<TurnoCajaRow>(manager, `SELECT t.*,u.username AS responsable,
        contado_apertura + $1::numeric - saldo_sistema_apertura AS esperado_actual
        FROM caja_turno t JOIN auth_user u ON u.id_user=t.abierto_por WHERE estado='Abierta'`, [saldo.caja_chica]);
      const [totales] = await queryRows<TotalesCajaRow>(manager, `SELECT coalesce(sum(greatest(efectivo,0)),0) AS entradas,
        coalesce(-sum(least(efectivo,0)),0) AS salidas FROM caja_movimiento WHERE id_movimiento>$1`,
        [turno?.id_movimiento_inicio ?? '9223372036854775807']);
      const historial = await queryRows<TurnoCajaRow>(manager, `SELECT t.*,u.username AS responsable FROM caja_turno t
        JOIN auth_user u ON u.id_user=t.abierto_por ORDER BY t.id_turno DESC LIMIT 50`);
      return { saldo, turno: turno ?? null, totales, historial };
    });
  }

  abrir(dto: ConteoCajaDto, userId?: number) {
    if (!userId) throw new BadRequestException('Se requiere un usuario registrado para abrir caja');
    return this.db.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext('caja-turno'))");
      const saldo = await this.saldo(manager, true);
      const [open] = await queryRows<Pick<TurnoCajaRow, 'id_turno'>>(manager, "SELECT id_turno FROM caja_turno WHERE estado='Abierta'");
      if (open) throw new ConflictException('Ya existe una caja abierta. Ciérrala antes de abrir otra.');
      const insertResult = await queryRows<TurnoCajaRow | TurnoCajaRow[]>(manager, `INSERT INTO caja_turno(abierto_por,contado_apertura,saldo_sistema_apertura,id_movimiento_inicio,notas_apertura)
        VALUES($1,$2,$3,(SELECT coalesce(max(id_movimiento),0) FROM caja_movimiento),$4) RETURNING *`,
        [userId, dto.contado, saldo.caja_chica, dto.notas?.trim() || null]);
      const turno = (Array.isArray(insertResult[0]) ? insertResult[0] : insertResult)[0];
      return turno;
    });
  }

  cerrar(id: number, dto: ConteoCajaDto, userId?: number) {
    if (!userId) throw new BadRequestException('Se requiere un usuario registrado para cerrar caja');
    return this.db.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext('caja-turno'))");
      const saldo = await this.saldo(manager, true);
      const [turno] = await queryRows<TurnoCajaRow>(manager, 'SELECT * FROM caja_turno WHERE id_turno=$1 FOR UPDATE', [id]);
      if (!turno) throw new NotFoundException('Turno no encontrado');
      if (turno.estado !== 'Abierta') throw new ConflictException('Este turno ya está cerrado');
      const closeResult = await queryRows<TurnoCajaRow | TurnoCajaRow[]>(manager, `WITH cierre AS (UPDATE caja_turno SET estado='Cerrada',cierre=clock_timestamp(),cerrado_por=$2,
        esperado_cierre=contado_apertura+$3::numeric-saldo_sistema_apertura,
        contado_cierre=$4,diferencia=$4::numeric-(contado_apertura+$3::numeric-saldo_sistema_apertura),
        id_movimiento_fin=(SELECT coalesce(max(id_movimiento),0) FROM caja_movimiento),notas_cierre=$5
        WHERE id_turno=$1 RETURNING *) SELECT * FROM cierre`, [id,userId,saldo.caja_chica,dto.contado,dto.notas?.trim() || null]);
      const closed = (Array.isArray(closeResult[0]) ? closeResult[0] : closeResult)[0];
      return closed;
    });
  }

  async movimientos(id: number, page: number) {
    const [turno] = await queryRows<TurnoCajaRow>(this.db, 'SELECT * FROM caja_turno WHERE id_turno=$1', [id]);
    if (!turno) throw new NotFoundException('Turno no encontrado');
    const rows = await queryRows<MovimientoCajaRow>(this.db, `SELECT m.*,u.username AS usuario,count(*) OVER() AS total_rows FROM caja_movimiento m
      LEFT JOIN auth_user u ON u.id_user=m.id_usuario
      WHERE id_movimiento>$1 AND ($2::bigint IS NULL OR id_movimiento<=$2)
      ORDER BY id_movimiento DESC LIMIT 50 OFFSET $3`, [turno.id_movimiento_inicio,turno.id_movimiento_fin,(page-1)*50]);
    return { data: rows, total: Number(rows[0]?.total_rows ?? 0), page, limit: 50 };
  }
}
