import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  ContabilidadQueryDto,
  CreatePeriodoDto,
  CreatePolizaDto,
  ExportarContabilidadDto,
  PresupuestoQueryDto,
  UpsertPresupuestoDto,
} from './finanzas.dto';
import { queryRows } from '../common/database/typed-query';

interface CuentaValidaRow {
  id_cuenta: number;
}
interface PolizaIdRow {
  id_poliza: number;
}
interface PolizaEstadoRow {
  estado: string;
  automatica: boolean;
}
interface BalancePolizaRow {
  debe: string | number;
  haber: string | number;
}

@Injectable()
export class ContabilidadService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getCuentasContables() {
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `
      SELECT c.id_cuenta AS "idCuenta",c.codigo,c.nombre,c.tipo,c.naturaleza,
             c.id_padre AS "idPadre",p.codigo AS "codigoPadre",c.acepta_movimientos AS "aceptaMovimientos",c.activa
      FROM cuenta_contable c LEFT JOIN cuenta_contable p ON p.id_cuenta=c.id_padre
      ORDER BY c.codigo`,
    );
  }

  async getPolizas(query: ContabilidadQueryDto) {
    this.validateDateRange(query.fechaInicio, query.fechaFin);
    const offset = (query.page - 1) * query.limit;
    const params = [
      query.fechaInicio || null,
      query.fechaFin || null,
      query.limit,
      offset,
    ];
    const filter = `WHERE ($1::date IS NULL OR p.fecha >= $1::date)
      AND ($2::date IS NULL OR p.fecha <= $2::date)`;
    const [rows, count] = await Promise.all([
      queryRows<Record<string, unknown>>(
        this.dataSource,
        `
        SELECT p.id_poliza AS "idPoliza",p.folio,p.fecha,p.tipo,p.concepto,p.estado,
               p.origen_tipo AS "origenTipo",p.origen_id AS "origenId",p.automatica,
               p.contabilizada_at AS "contabilizadaAt",u.username AS usuario,
               coalesce(sum(d.debe),0) AS debe,coalesce(sum(d.haber),0) AS haber,
               json_agg(json_build_object('idDetalle',d.id_detalle,'idCuenta',c.id_cuenta,
                 'codigo',c.codigo,'cuenta',c.nombre,'concepto',d.concepto,'referencia',d.referencia,
                 'debe',d.debe,'haber',d.haber) ORDER BY d.id_detalle)
                 FILTER (WHERE d.id_detalle IS NOT NULL) AS partidas
        FROM poliza_contable p
        LEFT JOIN poliza_contable_detalle d ON d.id_poliza=p.id_poliza
        LEFT JOIN cuenta_contable c ON c.id_cuenta=d.id_cuenta
        LEFT JOIN auth_user u ON u.id_user=p.id_usuario
        ${filter}
        GROUP BY p.id_poliza,u.username ORDER BY p.fecha DESC,p.folio DESC LIMIT $3 OFFSET $4`,
        params,
      ),
      queryRows<{ total: string | number }>(
        this.dataSource,
        `SELECT count(*) AS total FROM poliza_contable p ${filter}`,
        params.slice(0, 2),
      ),
    ]);
    const total = Number(count[0]?.total || 0);
    return {
      data: rows,
      total,
      page: query.page,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async crearPoliza(dto: CreatePolizaDto, idUsuario?: number) {
    const totalDebe = this.money(
      dto.partidas.reduce((sum, item) => sum + Number(item.debe), 0),
    );
    const totalHaber = this.money(
      dto.partidas.reduce((sum, item) => sum + Number(item.haber), 0),
    );
    if (totalDebe <= 0 || totalDebe !== totalHaber) {
      throw new BadRequestException(
        'La póliza debe cuadrar: cargos y abonos deben ser iguales',
      );
    }
    if (dto.partidas.some((item) => item.debe > 0 === item.haber > 0)) {
      throw new BadRequestException(
        'Cada partida debe tener solamente cargo o abono',
      );
    }
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const ids = [...new Set(dto.partidas.map((item) => item.idCuenta))];
      const accounts = await queryRows<CuentaValidaRow>(
        runner,
        `SELECT id_cuenta FROM cuenta_contable WHERE id_cuenta=ANY($1::int[]) AND activa AND acepta_movimientos FOR SHARE`,
        [ids],
      );
      if (accounts.length !== ids.length)
        throw new BadRequestException(
          'Una cuenta no existe, está inactiva o no acepta movimientos',
        );
      const result = await queryRows<PolizaIdRow>(
        runner,
        `INSERT INTO poliza_contable(fecha,tipo,concepto,id_usuario)
        VALUES($1,$2,$3,$4) RETURNING id_poliza`,
        [dto.fecha, dto.tipo, dto.concepto, idUsuario || null],
      );
      for (const item of dto.partidas) {
        await runner.query(
          `INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,referencia,debe,haber,id_centro_costo)
          VALUES($1,$2,$3,$4,$5,$6,coalesce($7,fn_centro_general()))`,
          [
            result[0].id_poliza,
            item.idCuenta,
            item.concepto || null,
            item.referencia || null,
            item.debe,
            item.haber,
            item.idCentroCosto || null,
          ],
        );
      }
      await runner.commitTransaction();
      return {
        message: 'Póliza guardada como borrador',
        idPoliza: result[0].id_poliza,
      };
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }

  async contabilizarPoliza(idPoliza: number) {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const header = await queryRows<PolizaEstadoRow>(
        runner,
        `SELECT estado,automatica FROM poliza_contable WHERE id_poliza=$1 FOR UPDATE`,
        [idPoliza],
      );
      if (!header.length) throw new NotFoundException('Póliza no encontrada');
      if (header[0].automatica)
        throw new BadRequestException(
          'Las pólizas automáticas ya se contabilizan con su documento',
        );
      if (header[0].estado !== 'Borrador')
        throw new BadRequestException(
          'Solo se pueden contabilizar pólizas en borrador',
        );
      const rows = await queryRows<BalancePolizaRow>(
        runner,
        `SELECT coalesce(sum(debe),0) AS debe,
        coalesce(sum(haber),0) AS haber FROM poliza_contable_detalle WHERE id_poliza=$1`,
        [idPoliza],
      );
      if (
        this.money(Number(rows[0].debe)) <= 0 ||
        this.money(Number(rows[0].debe)) !== this.money(Number(rows[0].haber))
      ) {
        throw new BadRequestException('La póliza no está cuadrada');
      }
      await runner.query(
        `UPDATE poliza_contable SET estado='Contabilizada',contabilizada_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE id_poliza=$1`,
        [idPoliza],
      );
      await runner.commitTransaction();
      return { message: 'Póliza contabilizada' };
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }

  async getBalanza(query: ContabilidadQueryDto) {
    this.validateDateRange(query.fechaInicio, query.fechaFin);
    const start =
      query.fechaInicio ||
      new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
    const end = query.fechaFin || new Date().toISOString().slice(0, 10);
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `
      SELECT c.id_cuenta AS "idCuenta",c.codigo,c.nombre,c.tipo,c.naturaleza,
        coalesce(sum(CASE WHEN p.fecha<$1::date THEN d.debe-d.haber ELSE 0 END),0) AS "saldoInicial",
        coalesce(sum(CASE WHEN p.fecha BETWEEN $1::date AND $2::date THEN d.debe ELSE 0 END),0) AS debe,
        coalesce(sum(CASE WHEN p.fecha BETWEEN $1::date AND $2::date THEN d.haber ELSE 0 END),0) AS haber,
        coalesce(sum(CASE WHEN p.fecha<=$2::date THEN d.debe-d.haber ELSE 0 END),0) AS "saldoFinal"
      FROM cuenta_contable c
      LEFT JOIN poliza_contable_detalle d ON d.id_cuenta=c.id_cuenta
      LEFT JOIN poliza_contable p ON p.id_poliza=d.id_poliza AND p.estado='Contabilizada'
      WHERE c.acepta_movimientos GROUP BY c.id_cuenta ORDER BY c.codigo`,
      [start, end],
    );
  }

  async getEstadoResultados(query: ContabilidadQueryDto) {
    this.validateDateRange(query.fechaInicio, query.fechaFin);
    const start =
      query.fechaInicio ||
      new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
    const end = query.fechaFin || new Date().toISOString().slice(0, 10);
    const detail = await queryRows<{
      tipo: string;
      codigo: string;
      nombre: string;
      saldo: string | number;
    }>(
      this.dataSource,
      `
      SELECT c.tipo,c.codigo,c.nombre,CASE WHEN c.tipo='Ingreso' THEN sum(d.haber-d.debe) ELSE sum(d.debe-d.haber) END AS saldo
      FROM poliza_contable_detalle d JOIN poliza_contable p ON p.id_poliza=d.id_poliza
      JOIN cuenta_contable c ON c.id_cuenta=d.id_cuenta
      WHERE p.estado='Contabilizada' AND p.fecha BETWEEN $1::date AND $2::date AND c.tipo IN ('Ingreso','Gasto')
      GROUP BY c.id_cuenta ORDER BY c.codigo`,
      [start, end],
    );
    const ingresos = this.money(
      detail
        .filter((x) => x.tipo === 'Ingreso')
        .reduce((s, x) => s + Number(x.saldo), 0),
    );
    const gastos = this.money(
      detail
        .filter((x) => x.tipo === 'Gasto')
        .reduce((s, x) => s + Number(x.saldo), 0),
    );
    return {
      fechaInicio: start,
      fechaFin: end,
      ingresos,
      gastos,
      utilidadNeta: this.money(ingresos - gastos),
      detalle: detail,
    };
  }

  async getBalanceGeneral(fecha?: string) {
    const end = fecha || new Date().toISOString().slice(0, 10);
    const detail = await queryRows<{
      tipo: string;
      codigo: string;
      nombre: string;
      saldo: string | number;
    }>(
      this.dataSource,
      `
      SELECT c.tipo,c.codigo,c.nombre,CASE WHEN c.tipo='Activo' THEN sum(d.debe-d.haber) ELSE sum(d.haber-d.debe) END AS saldo
      FROM poliza_contable_detalle d JOIN poliza_contable p ON p.id_poliza=d.id_poliza
      JOIN cuenta_contable c ON c.id_cuenta=d.id_cuenta
      WHERE p.estado='Contabilizada' AND p.fecha<=$1::date AND c.tipo IN ('Activo','Pasivo','Capital')
      GROUP BY c.id_cuenta ORDER BY c.codigo`,
      [end],
    );
    const result = await queryRows<{ saldo: string | number }>(
      this.dataSource,
      `SELECT coalesce(sum(CASE
      WHEN c.tipo='Ingreso' THEN d.haber-d.debe WHEN c.tipo='Gasto' THEN d.haber-d.debe ELSE 0 END),0) AS saldo
      FROM poliza_contable_detalle d JOIN poliza_contable p ON p.id_poliza=d.id_poliza
      JOIN cuenta_contable c ON c.id_cuenta=d.id_cuenta
      WHERE p.estado='Contabilizada' AND p.fecha<=$1::date AND c.tipo IN ('Ingreso','Gasto')`,
      [end],
    );
    const sum = (type: string) =>
      this.money(
        detail
          .filter((x) => x.tipo === type)
          .reduce((s, x) => s + Number(x.saldo), 0),
      );
    const activos = sum('Activo'),
      pasivos = sum('Pasivo'),
      capitalBase = sum('Capital');
    const resultadoAcumulado = this.money(Number(result[0]?.saldo || 0));
    const capital = this.money(capitalBase + resultadoAcumulado);
    return {
      fecha: end,
      activos,
      pasivos,
      capitalBase,
      resultadoAcumulado,
      capital,
      diferencia: this.money(activos - pasivos - capital),
      detalle: [
        ...detail,
        {
          tipo: 'Capital',
          codigo: '3999',
          nombre: 'Resultado acumulado',
          saldo: resultadoAcumulado,
        },
      ],
    };
  }

  async getPeriodos() {
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT p.id_periodo AS "idPeriodo",p.anio,p.mes,
      p.fecha_inicio AS "fechaInicio",p.fecha_fin AS "fechaFin",p.estado,p.cerrado_at AS "cerradoAt",u.username AS "cerradoPor",
      count(pc.id_poliza)::int AS polizas
      FROM periodo_contable p LEFT JOIN auth_user u ON u.id_user=p.cerrado_por
      LEFT JOIN poliza_contable pc ON pc.fecha BETWEEN p.fecha_inicio AND p.fecha_fin
      GROUP BY p.id_periodo,u.username ORDER BY p.anio DESC,p.mes DESC`,
    );
  }

  async crearPeriodo(dto: CreatePeriodoDto) {
    const rows = await queryRows<{ idPeriodo: number }>(
      this.dataSource,
      `INSERT INTO periodo_contable(anio,mes)
      VALUES($1,$2) ON CONFLICT(anio,mes) DO UPDATE SET anio=EXCLUDED.anio
      RETURNING id_periodo AS "idPeriodo"`,
      [dto.anio, dto.mes],
    );
    return {
      message: 'Periodo contable disponible',
      idPeriodo: rows[0].idPeriodo,
    };
  }

  async cerrarPeriodo(idPeriodo: number, idUsuario?: number) {
    if (!idUsuario)
      throw new BadRequestException(
        'Se requiere un usuario registrado para cerrar el periodo',
      );
    return this.dataSource.transaction(async (manager) => {
      const period = await queryRows<{
        fechaInicio: string;
        fechaFin: string;
        estado: string;
      }>(
        manager,
        `SELECT fecha_inicio AS "fechaInicio",
        fecha_fin AS "fechaFin",estado FROM periodo_contable WHERE id_periodo=$1 FOR UPDATE`,
        [idPeriodo],
      );
      if (!period.length) throw new NotFoundException('Periodo no encontrado');
      if (period[0].estado === 'Cerrado')
        throw new BadRequestException('El periodo ya está cerrado');
      const drafts = await queryRows<{ total: string | number }>(
        manager,
        `SELECT count(*) AS total FROM poliza_contable
        WHERE fecha BETWEEN $1 AND $2 AND estado='Borrador'`,
        [period[0].fechaInicio, period[0].fechaFin],
      );
      if (Number(drafts[0].total) > 0)
        throw new BadRequestException(
          'Contabiliza o cancela todas las pólizas en borrador antes de cerrar',
        );
      const unbalanced = await queryRows<{ total: string | number }>(
        manager,
        `SELECT count(*) AS total FROM (SELECT p.id_poliza
        FROM poliza_contable p JOIN poliza_contable_detalle d ON d.id_poliza=p.id_poliza
        WHERE p.fecha BETWEEN $1 AND $2 AND p.estado='Contabilizada' GROUP BY p.id_poliza HAVING sum(d.debe)<>sum(d.haber)) x`,
        [period[0].fechaInicio, period[0].fechaFin],
      );
      if (Number(unbalanced[0].total) > 0)
        throw new BadRequestException(
          'Existen pólizas descuadradas en el periodo',
        );
      await manager.query(
        `UPDATE periodo_contable SET estado='Cerrado',cerrado_por=$2,cerrado_at=clock_timestamp() WHERE id_periodo=$1`,
        [idPeriodo, idUsuario],
      );
      return { message: 'Periodo contable cerrado' };
    });
  }

  async getCentrosCosto() {
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT id_centro AS "idCentroCosto",codigo,nombre,activo
      FROM centro_costo ORDER BY activo DESC,codigo`,
    );
  }

  async getPresupuestos(query: PresupuestoQueryDto) {
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT b.id_presupuesto AS "idPresupuesto",b.anio,b.mes,
      c.id_cuenta AS "idCuenta",c.codigo,c.nombre AS cuenta,cc.id_centro AS "idCentroCosto",cc.nombre AS centro,
      b.monto,b.notas,coalesce(sum(CASE WHEN p.id_poliza IS NULL THEN 0 WHEN c.tipo='Ingreso' THEN d.haber-d.debe ELSE d.debe-d.haber END),0) AS real,
      b.monto-coalesce(sum(CASE WHEN p.id_poliza IS NULL THEN 0 WHEN c.tipo='Ingreso' THEN d.haber-d.debe ELSE d.debe-d.haber END),0) AS variacion
      FROM presupuesto_contable b JOIN cuenta_contable c ON c.id_cuenta=b.id_cuenta
      LEFT JOIN centro_costo cc ON cc.id_centro=b.id_centro_costo
      LEFT JOIN poliza_contable_detalle d ON d.id_cuenta=b.id_cuenta AND (b.id_centro_costo IS NULL OR d.id_centro_costo=b.id_centro_costo)
      LEFT JOIN poliza_contable p ON p.id_poliza=d.id_poliza AND p.estado='Contabilizada'
        AND extract(year FROM p.fecha)=$1 AND extract(month FROM p.fecha)=$2
      WHERE b.anio=$1 AND b.mes=$2 GROUP BY b.id_presupuesto,c.id_cuenta,cc.id_centro ORDER BY c.codigo,cc.nombre NULLS FIRST`,
      [query.anio, query.mes],
    );
  }

  async guardarPresupuesto(dto: UpsertPresupuestoDto) {
    const account = await queryRows<{ id_cuenta: number }>(
      this.dataSource,
      `SELECT id_cuenta FROM cuenta_contable
      WHERE id_cuenta=$1 AND activa AND acepta_movimientos`,
      [dto.idCuenta],
    );
    if (!account.length)
      throw new NotFoundException('Cuenta contable no disponible');
    if (dto.idCentroCosto) {
      const center = await queryRows<{ id_centro: number }>(
        this.dataSource,
        `SELECT id_centro FROM centro_costo WHERE id_centro=$1 AND activo`,
        [dto.idCentroCosto],
      );
      if (!center.length)
        throw new NotFoundException('Centro de costo no disponible');
      await this.dataSource.query(
        `INSERT INTO presupuesto_contable(anio,mes,id_cuenta,id_centro_costo,monto,notas)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(anio,mes,id_cuenta,id_centro_costo) WHERE id_centro_costo IS NOT NULL
        DO UPDATE SET monto=EXCLUDED.monto,notas=EXCLUDED.notas,updated_at=clock_timestamp()`,
        [
          dto.anio,
          dto.mes,
          dto.idCuenta,
          dto.idCentroCosto,
          dto.monto,
          dto.notas || null,
        ],
      );
    } else {
      await this.dataSource.query(
        `INSERT INTO presupuesto_contable(anio,mes,id_cuenta,monto,notas)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(anio,mes,id_cuenta) WHERE id_centro_costo IS NULL
        DO UPDATE SET monto=EXCLUDED.monto,notas=EXCLUDED.notas,updated_at=clock_timestamp()`,
        [dto.anio, dto.mes, dto.idCuenta, dto.monto, dto.notas || null],
      );
    }
    return { message: 'Presupuesto actualizado' };
  }

  async getFlujoEfectivo(query: ContabilidadQueryDto) {
    this.validateDateRange(query.fechaInicio, query.fechaFin);
    const start =
      query.fechaInicio ||
      new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
    const end = query.fechaFin || new Date().toISOString().slice(0, 10);
    const opening = await queryRows<{ saldo: string | number }>(
      this.dataSource,
      `SELECT coalesce(sum(d.debe-d.haber),0) AS saldo
      FROM poliza_contable_detalle d JOIN poliza_contable p ON p.id_poliza=d.id_poliza JOIN cuenta_contable c ON c.id_cuenta=d.id_cuenta
      WHERE p.estado='Contabilizada' AND p.fecha<$1 AND c.codigo IN('1100','1110')`,
      [start],
    );
    const detail = await queryRows<{
      origen: string;
      ingresos: string | number;
      egresos: string | number;
      neto: string | number;
    }>(
      this.dataSource,
      `SELECT
      coalesce(p.origen_tipo,'Póliza manual') AS origen,sum(d.debe) AS ingresos,sum(d.haber) AS egresos,sum(d.debe-d.haber) AS neto
      FROM poliza_contable_detalle d JOIN poliza_contable p ON p.id_poliza=d.id_poliza JOIN cuenta_contable c ON c.id_cuenta=d.id_cuenta
      WHERE p.estado='Contabilizada' AND p.fecha BETWEEN $1 AND $2 AND c.codigo IN('1100','1110')
      GROUP BY coalesce(p.origen_tipo,'Póliza manual') ORDER BY origen`,
      [start, end],
    );
    const saldoInicial = this.money(Number(opening[0]?.saldo || 0));
    const ingresos = this.money(
      detail.reduce((s, x) => s + Number(x.ingresos), 0),
    );
    const egresos = this.money(
      detail.reduce((s, x) => s + Number(x.egresos), 0),
    );
    return {
      fechaInicio: start,
      fechaFin: end,
      saldoInicial,
      ingresos,
      egresos,
      flujoNeto: this.money(ingresos - egresos),
      saldoFinal: this.money(saldoInicial + ingresos - egresos),
      detalle: detail,
    };
  }

  async exportarContabilidad(query: ExportarContabilidadDto) {
    let rows: Record<string, unknown>[];
    if (query.reporte === 'balanza') rows = await this.getBalanza(query);
    else if (query.reporte === 'resultados') {
      const result = await this.getEstadoResultados(query);
      rows = result.detalle;
    } else if (query.reporte === 'balance') {
      const result = await this.getBalanceGeneral(query.fechaFin);
      rows = result.detalle;
    } else {
      const result = await this.getFlujoEfectivo(query);
      rows = result.detalle;
    }
    return this.toCsv(rows);
  }

  private toCsv(rows: Record<string, unknown>[]) {
    if (!rows.length) return '\uFEFFSin datos\r\n';
    const headers = Object.keys(rows[0]);
    const cell = (value: unknown) => {
      let text = '';
      if (typeof value === 'string') text = value;
      else if (
        typeof value === 'number' ||
        typeof value === 'bigint' ||
        typeof value === 'boolean'
      )
        text = value.toString();
      else if (value instanceof Date) text = value.toISOString();
      else if (value !== null && value !== undefined)
        text = JSON.stringify(value) ?? '';
      if (/^[=+@-]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    return `\uFEFF${headers.map(cell).join(',')}\r\n${rows.map((row) => headers.map((key) => cell(row[key])).join(',')).join('\r\n')}\r\n`;
  }

  private validateDateRange(start?: string, end?: string) {
    if (start && end && start > end)
      throw new BadRequestException(
        'La fecha inicial no puede ser posterior a la final',
      );
  }

  private money(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
