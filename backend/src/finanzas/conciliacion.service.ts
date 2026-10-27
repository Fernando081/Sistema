import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';
import {
  ConciliarMovimientoDto,
  CreateBankReconciliationDto,
} from './finanzas.dto';
import { queryRows } from '../common/database/typed-query';

@Injectable()
export class ConciliacionService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getCandidatosConciliacion(idMovimiento: number) {
    const movement = await queryRows<{ fecha: string; monto: string | number }>(
      this.dataSource,
      `SELECT fecha,monto FROM tesoreria_movimiento WHERE id_movimiento=$1 AND estado='Pendiente'`,
      [idMovimiento],
    );
    if (!movement.length)
      throw new NotFoundException('Movimiento pendiente no encontrado');
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT cm.id_movimiento AS "idCajaMovimiento",cm.fecha,cm.banco AS monto,
      cm.saldo_banco AS "saldoBanco",cm.origen,u.username AS usuario,
      abs(cm.banco-$2::numeric) AS diferencia,abs(cm.fecha::date-$1::date) AS dias,
      greatest(0,100-abs(cm.fecha::date-$1::date)*5-least(abs(cm.banco-$2::numeric),100)) AS puntaje
      FROM caja_movimiento cm LEFT JOIN auth_user u ON u.id_user=cm.id_usuario
      WHERE cm.banco<>0 AND NOT EXISTS(SELECT 1 FROM tesoreria_conciliacion_sistema cs WHERE cs.id_caja_movimiento=cm.id_movimiento AND cs.activo)
        AND cm.fecha::date BETWEEN $1::date-7 AND $1::date+7
      ORDER BY abs(cm.banco-$2::numeric),abs(cm.fecha::date-$1::date),cm.id_movimiento LIMIT 20`,
      [movement[0].fecha, movement[0].monto],
    );
  }

  async conciliarMovimiento(
    idMovimiento: number,
    dto: ConciliarMovimientoDto,
    idUsuario?: number,
  ) {
    return this.crearConciliacion(
      {
        requestId: randomUUID(),
        movimientosBanco: [idMovimiento],
        movimientosSistema: [dto.idCajaMovimiento],
      },
      idUsuario,
    );
  }

  async crearConciliacion(
    dto: CreateBankReconciliationDto,
    idUsuario?: number,
  ) {
    if (
      new Set(dto.movimientosBanco).size !== dto.movimientosBanco.length ||
      new Set(dto.movimientosSistema).size !== dto.movimientosSistema.length
    ) {
      throw new BadRequestException(
        'No repitas movimientos dentro de una conciliación',
      );
    }
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtext('treasury-reconciliation:'||$1))`,
        [dto.requestId],
      );
      const previous = await queryRows<{ idConciliacion: number }>(
        manager,
        `SELECT id_conciliacion AS "idConciliacion" FROM tesoreria_conciliacion WHERE request_id=$1`,
        [dto.requestId],
      );
      if (previous.length)
        return {
          message: 'Conciliación ya registrada',
          ...previous[0],
          repeated: true,
        };
      const bank = await queryRows<{
        id: number;
        idCuenta: number;
        monto: string | number;
      }>(
        manager,
        `SELECT id_movimiento AS id,id_cuenta AS "idCuenta",monto FROM tesoreria_movimiento
         WHERE id_movimiento=ANY($1::bigint[]) AND estado='Pendiente' ORDER BY id_movimiento FOR UPDATE`,
        [dto.movimientosBanco],
      );
      if (bank.length !== dto.movimientosBanco.length)
        throw new ConflictException(
          'Uno o más movimientos bancarios ya no están pendientes',
        );
      const accountIds = new Set(bank.map((row) => Number(row.idCuenta)));
      if (accountIds.size !== 1)
        throw new BadRequestException(
          'Una conciliación sólo puede contener movimientos de la misma cuenta',
        );
      const system = await queryRows<{ id: number; banco: string | number }>(
        manager,
        `SELECT cm.id_movimiento AS id,cm.banco FROM caja_movimiento cm
         WHERE cm.id_movimiento=ANY($1::bigint[]) AND cm.banco<>0
           AND NOT EXISTS(SELECT 1 FROM tesoreria_conciliacion_sistema cs WHERE cs.id_caja_movimiento=cm.id_movimiento AND cs.activo)
         ORDER BY cm.id_movimiento FOR UPDATE OF cm`,
        [dto.movimientosSistema],
      );
      if (system.length !== dto.movimientosSistema.length)
        throw new ConflictException(
          'Uno o más movimientos del sistema ya no están disponibles',
        );
      const totalBanco = this.money(
        bank.reduce((sum, row) => sum + Number(row.monto), 0),
      );
      const totalSistema = this.money(
        system.reduce((sum, row) => sum + Number(row.banco), 0),
      );
      const ajuste = this.money(totalBanco - totalSistema);
      if (ajuste !== 0 && (!dto.tipoAjuste || !dto.motivo)) {
        throw new BadRequestException(
          'Documenta el tipo y motivo de la diferencia antes de conciliar',
        );
      }
      if (ajuste === 0 && (dto.tipoAjuste || dto.motivo))
        throw new BadRequestException(
          'No agregues un ajuste cuando los totales coinciden',
        );
      const created = await queryRows<{ idConciliacion: number }>(
        manager,
        `INSERT INTO tesoreria_conciliacion
        (request_id,id_cuenta,tipo,total_banco,total_sistema,ajuste,tipo_ajuste,motivo,id_usuario)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id_conciliacion AS "idConciliacion"`,
        [
          dto.requestId,
          [...accountIds][0],
          ajuste === 0 ? 'Exacta' : 'Ajuste',
          totalBanco,
          totalSistema,
          ajuste,
          dto.tipoAjuste || null,
          dto.motivo || null,
          idUsuario || null,
        ],
      );
      const id = created[0].idConciliacion;
      await manager.query(
        `UPDATE tesoreria_movimiento SET estado='Conciliado',id_conciliacion=$2,
        conciliado_por=$3,conciliado_at=clock_timestamp(),metodo_conciliacion='Manual',puntaje_conciliacion=$4,
        observaciones=NULL,updated_at=clock_timestamp() WHERE id_movimiento=ANY($1::bigint[])`,
        [dto.movimientosBanco, id, idUsuario || null, ajuste === 0 ? 100 : 90],
      );
      for (const row of system)
        await manager.query(
          `INSERT INTO tesoreria_conciliacion_sistema(id_conciliacion,id_caja_movimiento,monto)
        VALUES($1,$2,$3)`,
          [id, row.id, row.banco],
        );
      if (ajuste !== 0)
        await this.registrarAjusteConciliacion(
          manager,
          id,
          ajuste,
          dto.tipoAjuste!,
          dto.motivo!,
          idUsuario,
        );
      return {
        message:
          ajuste === 0
            ? 'Conciliación registrada'
            : 'Conciliación con ajuste registrada',
        idConciliacion: id,
        totalBanco,
        totalSistema,
        ajuste,
      };
    });
  }

  getConciliaciones() {
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT c.id_conciliacion AS "idConciliacion",c.id_cuenta AS "idCuenta",
      tc.nombre AS cuenta,c.tipo,c.estado,c.total_banco AS "totalBanco",c.total_sistema AS "totalSistema",c.ajuste,
      c.tipo_ajuste AS "tipoAjuste",c.motivo,c.created_at AS "createdAt",u.username AS usuario,
      count(DISTINCT tm.id_movimiento)::int AS "movimientosBanco",
      count(DISTINCT cs.id_caja_movimiento)::int AS "movimientosSistema"
      FROM tesoreria_conciliacion c LEFT JOIN tesoreria_cuenta tc ON tc.id_cuenta=c.id_cuenta
      LEFT JOIN tesoreria_movimiento tm ON tm.id_conciliacion=c.id_conciliacion
      LEFT JOIN tesoreria_conciliacion_sistema cs ON cs.id_conciliacion=c.id_conciliacion
      LEFT JOIN auth_user u ON u.id_user=c.id_usuario GROUP BY c.id_conciliacion,tc.nombre,u.username
      ORDER BY c.created_at DESC LIMIT 100`,
    );
  }

  async desconciliarMovimiento(
    idMovimiento: number,
    motivo: string,
    idUsuario?: number,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const groups = await queryRows<{
        id: number;
        estado: string;
        ajuste: string | number;
      }>(
        manager,
        `SELECT c.id_conciliacion AS id,c.estado,c.ajuste
        FROM tesoreria_movimiento m JOIN tesoreria_conciliacion c ON c.id_conciliacion=m.id_conciliacion
        WHERE m.id_movimiento=$1 FOR UPDATE OF c`,
        [idMovimiento],
      );
      if (!groups.length || groups[0].estado !== 'Activa')
        throw new ConflictException(
          'El movimiento no tiene una conciliación activa',
        );
      const group = groups[0];
      await manager.query(
        `UPDATE tesoreria_movimiento SET estado='Pendiente',id_conciliacion=NULL,conciliado_por=NULL,
        conciliado_at=NULL,metodo_conciliacion=NULL,puntaje_conciliacion=NULL,observaciones=$2,updated_at=clock_timestamp()
        WHERE id_conciliacion=$1`,
        [group.id, `Desconciliado: ${motivo}`],
      );
      await manager.query(
        `UPDATE tesoreria_conciliacion_sistema SET activo=false WHERE id_conciliacion=$1 AND NOT generado_ajuste`,
        [group.id],
      );
      const ajuste = this.money(Number(group.ajuste));
      if (ajuste !== 0)
        await this.revertirAjusteConciliacion(
          manager,
          group.id,
          ajuste,
          idUsuario,
        );
      await manager.query(
        `UPDATE tesoreria_conciliacion SET estado='Revertida',revertida_por=$2,revertida_at=clock_timestamp(),
        motivo_reversion=$3 WHERE id_conciliacion=$1`,
        [group.id, idUsuario || null, motivo],
      );
      return {
        message: 'Conciliación completa revertida',
        idConciliacion: group.id,
      };
    });
  }

  async ignorarMovimiento(idMovimiento: number, motivo: string) {
    const rows = await queryRows<{ id: number }>(
      this.dataSource,
      `UPDATE tesoreria_movimiento SET estado='Ignorado',observaciones=$2,
      updated_at=clock_timestamp() WHERE id_movimiento=$1 AND estado='Pendiente' RETURNING id_movimiento AS id`,
      [idMovimiento, motivo],
    );
    if (!rows.length)
      throw new ConflictException('El movimiento no está pendiente');
    return { message: 'Movimiento marcado como ignorado' };
  }

  async crearConciliacionExacta(
    manager: EntityManager,
    idMovimiento: number,
    idCajaMovimiento: number,
    idUsuario: number | undefined,
    metodo: 'Manual' | 'Automatica',
  ) {
    const bank = await queryRows<{ idCuenta: number; monto: string | number }>(
      manager,
      `SELECT id_cuenta AS "idCuenta",monto FROM tesoreria_movimiento WHERE id_movimiento=$1 AND estado='Pendiente' FOR UPDATE`,
      [idMovimiento],
    );
    const system = await queryRows<{ monto: string | number }>(
      manager,
      `SELECT cm.banco AS monto FROM caja_movimiento cm WHERE cm.id_movimiento=$1
      AND cm.banco<>0 AND NOT EXISTS(SELECT 1 FROM tesoreria_conciliacion_sistema cs WHERE cs.id_caja_movimiento=cm.id_movimiento AND cs.activo)
      FOR UPDATE OF cm`,
      [idCajaMovimiento],
    );
    if (
      !bank.length ||
      !system.length ||
      this.money(Number(bank[0].monto)) !== this.money(Number(system[0].monto))
    ) {
      throw new ConflictException(
        'La coincidencia exacta ya no está disponible',
      );
    }
    const group = await queryRows<{ id: number }>(
      manager,
      `INSERT INTO tesoreria_conciliacion
      (request_id,id_cuenta,tipo,total_banco,total_sistema,ajuste,motivo,id_usuario)
      VALUES($1,$2,'Exacta',$3,$3,0,$4,$5) RETURNING id_conciliacion AS id`,
      [
        randomUUID(),
        bank[0].idCuenta,
        bank[0].monto,
        metodo === 'Automatica'
          ? 'Coincidencia automática única'
          : 'Coincidencia manual',
        idUsuario || null,
      ],
    );
    await manager.query(
      `INSERT INTO tesoreria_conciliacion_sistema(id_conciliacion,id_caja_movimiento,monto) VALUES($1,$2,$3)`,
      [group[0].id, idCajaMovimiento, system[0].monto],
    );
    await manager.query(
      `UPDATE tesoreria_movimiento SET estado='Conciliado',id_conciliacion=$2,conciliado_por=$3,
      conciliado_at=clock_timestamp(),metodo_conciliacion=$4,puntaje_conciliacion=100,observaciones=NULL,updated_at=clock_timestamp()
      WHERE id_movimiento=$1`,
      [idMovimiento, group[0].id, idUsuario || null, metodo],
    );
    return group[0].id;
  }

  private async registrarAjusteConciliacion(
    manager: EntityManager,
    idConciliacion: number,
    ajuste: number,
    tipo: string,
    motivo: string,
    idUsuario?: number,
  ) {
    const origin = `Ajuste conciliación bancaria #${idConciliacion}`;
    await manager.query(
      `SELECT set_config('app.current_user_id',$1,true),set_config('app.movement_origin',$2,true)`,
      [idUsuario ? String(idUsuario) : '', origin],
    );
    const balances = await queryRows<{ id: number }>(
      manager,
      `UPDATE saldos SET cuenta_banco=cuenta_banco+$1
      WHERE id_saldo=(SELECT min(id_saldo) FROM saldos) RETURNING id_saldo AS id`,
      [ajuste],
    );
    if (!balances.length)
      throw new BadRequestException(
        'Configura el saldo bancario general antes de registrar ajustes',
      );
    const movements = await queryRows<{ id: number; monto: string | number }>(
      manager,
      `SELECT id_movimiento AS id,banco AS monto FROM caja_movimiento WHERE origen=$1 ORDER BY id_movimiento DESC LIMIT 1`,
      [origin],
    );
    if (!movements.length)
      throw new InternalServerErrorException(
        'No se pudo generar el movimiento de ajuste',
      );
    await manager.query(
      `INSERT INTO tesoreria_conciliacion_sistema(id_conciliacion,id_caja_movimiento,monto,generado_ajuste)
      VALUES($1,$2,$3,true)`,
      [idConciliacion, movements[0].id, movements[0].monto],
    );
    const policies = await queryRows<{ id: number }>(
      manager,
      `SELECT fn_preparar_poliza_automatica('AjusteBancario',$1,current_date,'Diario',$2,true) AS id`,
      [idConciliacion, `${tipo}: ${motivo}`],
    );
    const amount = Math.abs(ajuste);
    const debit = ajuste < 0 ? (tipo === 'Comision' ? '6010' : '6020') : '1110';
    const credit = ajuste < 0 ? '1110' : '4090';
    await manager.query(
      `INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe)
      VALUES($1,fn_cuenta_contable_id($2),$3,$4)`,
      [policies[0].id, debit, motivo, amount],
    );
    await manager.query(
      `INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber)
      VALUES($1,fn_cuenta_contable_id($2),$3,$4)`,
      [policies[0].id, credit, motivo, amount],
    );
  }

  private async revertirAjusteConciliacion(
    manager: EntityManager,
    idConciliacion: number,
    ajuste: number,
    idUsuario?: number,
  ) {
    const origin = `Reverso ajuste conciliación bancaria #${idConciliacion}`;
    await manager.query(
      `SELECT set_config('app.current_user_id',$1,true),set_config('app.movement_origin',$2,true)`,
      [idUsuario ? String(idUsuario) : '', origin],
    );
    await manager.query(
      `UPDATE saldos SET cuenta_banco=cuenta_banco-$1 WHERE id_saldo=(SELECT min(id_saldo) FROM saldos)`,
      [ajuste],
    );
    await manager.query(
      `SELECT fn_preparar_poliza_automatica('AjusteBancario',$1,current_date,'Diario',$2,false)`,
      [idConciliacion, origin],
    );
  }

  private money(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
