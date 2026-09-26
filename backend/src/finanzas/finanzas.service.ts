import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { createHash } from 'node:crypto';
import { Gasto } from './entities/gasto.entity';
import { Saldo } from './entities/saldo.entity';
import { ConciliarMovimientoDto, ContabilidadQueryDto, CreateCuentaTesoreriaDto, CreateGastoDto, CreateMovimientoTesoreriaDto, CreatePeriodoDto, CreatePolizaDto, ExportarContabilidadDto, ImportBankStatementDto, PresupuestoQueryDto, UpsertPresupuestoDto } from './finanzas.dto';
import PdfPrinter from 'pdfmake';
import { TDocumentDefinitions } from 'pdfmake/interfaces';
import { queryRows } from '../common/database/typed-query';
import { parseBankStatementCsv } from './bank-statement.parser';

interface GastoResumenRow { categoria: string; total_gastado: string | number; }
interface PagoProveedorResumenRow { forma_pago: string; total_pagado: string | number; }
interface IngresoResumenRow { forma_pago: string; total_ingreso: string | number; }
interface CuentaValidaRow { id_cuenta: number; }
interface PolizaIdRow { id_poliza: number; }
interface PolizaEstadoRow { estado: string; automatica: boolean; }
interface BalancePolizaRow { debe: string | number; haber: string | number; }

// Fonts for pdfmake using standard fonts
const fonts = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
};

@Injectable()
export class FinanzasService {
  constructor(
    @InjectDataSource() private dataSource: DataSource,
    @InjectRepository(Gasto) private gastoRepository: Repository<Gasto>,
    @InjectRepository(Saldo) private saldoRepository: Repository<Saldo>,
  ) {}

  async crearGasto(createGastoDto: CreateGastoDto, idUsuario?: number) {
    const gasto = this.gastoRepository.create({
      ...createGastoDto,
      idUsuario: idUsuario || undefined,
    });
    // This simple save will trigger the DB trigger trg_gasto_saldos_y_landed_cost automatically
    // resolving cash logic and Landed Cost.
    await this.gastoRepository.save(gasto);
    return { message: 'Gasto registrado con éxito' };
  }

  async findAllGastos() {
    return this.gastoRepository.find({ where: { anulado: false }, order: { fecha: 'DESC' } });
  }

  async getSaldos() {
    return this.saldoRepository.find();
  }

  async getCuentasContables() {
    return queryRows<Record<string, unknown>>(this.dataSource, `
      SELECT c.id_cuenta AS "idCuenta",c.codigo,c.nombre,c.tipo,c.naturaleza,
             c.id_padre AS "idPadre",p.codigo AS "codigoPadre",c.acepta_movimientos AS "aceptaMovimientos",c.activa
      FROM cuenta_contable c LEFT JOIN cuenta_contable p ON p.id_cuenta=c.id_padre
      ORDER BY c.codigo`);
  }

  async getPolizas(query: ContabilidadQueryDto) {
    this.validateDateRange(query.fechaInicio, query.fechaFin);
    const offset = (query.page - 1) * query.limit;
    const params = [query.fechaInicio || null, query.fechaFin || null, query.limit, offset];
    const filter = `WHERE ($1::date IS NULL OR p.fecha >= $1::date)
      AND ($2::date IS NULL OR p.fecha <= $2::date)`;
    const [rows, count] = await Promise.all([
      queryRows<Record<string, unknown>>(this.dataSource, `
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
        GROUP BY p.id_poliza,u.username ORDER BY p.fecha DESC,p.folio DESC LIMIT $3 OFFSET $4`, params),
      queryRows<{ total: string | number }>(this.dataSource,
        `SELECT count(*) AS total FROM poliza_contable p ${filter}`, params.slice(0, 2)),
    ]);
    const total = Number(count[0]?.total || 0);
    return { data: rows, total, page: query.page, totalPages: Math.ceil(total / query.limit) };
  }

  async crearPoliza(dto: CreatePolizaDto, idUsuario?: number) {
    const totalDebe = this.money(dto.partidas.reduce((sum, item) => sum + Number(item.debe), 0));
    const totalHaber = this.money(dto.partidas.reduce((sum, item) => sum + Number(item.haber), 0));
    if (totalDebe <= 0 || totalDebe !== totalHaber) {
      throw new BadRequestException('La póliza debe cuadrar: cargos y abonos deben ser iguales');
    }
    if (dto.partidas.some((item) => (item.debe > 0) === (item.haber > 0))) {
      throw new BadRequestException('Cada partida debe tener solamente cargo o abono');
    }
    const runner = this.dataSource.createQueryRunner();
    await runner.connect(); await runner.startTransaction();
    try {
      const ids = [...new Set(dto.partidas.map((item) => item.idCuenta))];
      const accounts = await queryRows<CuentaValidaRow>(runner,
        `SELECT id_cuenta FROM cuenta_contable WHERE id_cuenta=ANY($1::int[]) AND activa AND acepta_movimientos FOR SHARE`, [ids]);
      if (accounts.length !== ids.length) throw new BadRequestException('Una cuenta no existe, está inactiva o no acepta movimientos');
      const result = await queryRows<PolizaIdRow>(runner, `INSERT INTO poliza_contable(fecha,tipo,concepto,id_usuario)
        VALUES($1,$2,$3,$4) RETURNING id_poliza`, [dto.fecha,dto.tipo,dto.concepto,idUsuario || null]);
      for (const item of dto.partidas) {
        await runner.query(`INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,referencia,debe,haber,id_centro_costo)
          VALUES($1,$2,$3,$4,$5,$6,coalesce($7,fn_centro_general()))`, [result[0].id_poliza,item.idCuenta,item.concepto || null,item.referencia || null,item.debe,item.haber,item.idCentroCosto || null]);
      }
      await runner.commitTransaction();
      return { message: 'Póliza guardada como borrador', idPoliza: result[0].id_poliza };
    } catch (error) { await runner.rollbackTransaction(); throw error; }
    finally { await runner.release(); }
  }

  async contabilizarPoliza(idPoliza: number) {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect(); await runner.startTransaction();
    try {
      const header = await queryRows<PolizaEstadoRow>(runner,
        `SELECT estado,automatica FROM poliza_contable WHERE id_poliza=$1 FOR UPDATE`, [idPoliza]);
      if (!header.length) throw new NotFoundException('Póliza no encontrada');
      if (header[0].automatica) throw new BadRequestException('Las pólizas automáticas ya se contabilizan con su documento');
      if (header[0].estado !== 'Borrador') throw new BadRequestException('Solo se pueden contabilizar pólizas en borrador');
      const rows = await queryRows<BalancePolizaRow>(runner, `SELECT coalesce(sum(debe),0) AS debe,
        coalesce(sum(haber),0) AS haber FROM poliza_contable_detalle WHERE id_poliza=$1`, [idPoliza]);
      if (this.money(Number(rows[0].debe)) <= 0 || this.money(Number(rows[0].debe)) !== this.money(Number(rows[0].haber))) {
        throw new BadRequestException('La póliza no está cuadrada');
      }
      await runner.query(`UPDATE poliza_contable SET estado='Contabilizada',contabilizada_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE id_poliza=$1`, [idPoliza]);
      await runner.commitTransaction(); return { message: 'Póliza contabilizada' };
    } catch (error) { await runner.rollbackTransaction(); throw error; }
    finally { await runner.release(); }
  }

  async getBalanza(query: ContabilidadQueryDto) {
    this.validateDateRange(query.fechaInicio, query.fechaFin);
    const start = query.fechaInicio || new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
    const end = query.fechaFin || new Date().toISOString().slice(0, 10);
    return queryRows<Record<string, unknown>>(this.dataSource, `
      SELECT c.id_cuenta AS "idCuenta",c.codigo,c.nombre,c.tipo,c.naturaleza,
        coalesce(sum(CASE WHEN p.fecha<$1::date THEN d.debe-d.haber ELSE 0 END),0) AS "saldoInicial",
        coalesce(sum(CASE WHEN p.fecha BETWEEN $1::date AND $2::date THEN d.debe ELSE 0 END),0) AS debe,
        coalesce(sum(CASE WHEN p.fecha BETWEEN $1::date AND $2::date THEN d.haber ELSE 0 END),0) AS haber,
        coalesce(sum(CASE WHEN p.fecha<=$2::date THEN d.debe-d.haber ELSE 0 END),0) AS "saldoFinal"
      FROM cuenta_contable c
      LEFT JOIN poliza_contable_detalle d ON d.id_cuenta=c.id_cuenta
      LEFT JOIN poliza_contable p ON p.id_poliza=d.id_poliza AND p.estado='Contabilizada'
      WHERE c.acepta_movimientos GROUP BY c.id_cuenta ORDER BY c.codigo`, [start,end]);
  }

  async getEstadoResultados(query: ContabilidadQueryDto) {
    this.validateDateRange(query.fechaInicio, query.fechaFin);
    const start = query.fechaInicio || new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
    const end = query.fechaFin || new Date().toISOString().slice(0, 10);
    const detail = await queryRows<{ tipo: string; codigo: string; nombre: string; saldo: string | number }>(this.dataSource, `
      SELECT c.tipo,c.codigo,c.nombre,CASE WHEN c.tipo='Ingreso' THEN sum(d.haber-d.debe) ELSE sum(d.debe-d.haber) END AS saldo
      FROM poliza_contable_detalle d JOIN poliza_contable p ON p.id_poliza=d.id_poliza
      JOIN cuenta_contable c ON c.id_cuenta=d.id_cuenta
      WHERE p.estado='Contabilizada' AND p.fecha BETWEEN $1::date AND $2::date AND c.tipo IN ('Ingreso','Gasto')
      GROUP BY c.id_cuenta ORDER BY c.codigo`, [start,end]);
    const ingresos = this.money(detail.filter(x=>x.tipo==='Ingreso').reduce((s,x)=>s+Number(x.saldo),0));
    const gastos = this.money(detail.filter(x=>x.tipo==='Gasto').reduce((s,x)=>s+Number(x.saldo),0));
    return { fechaInicio:start,fechaFin:end,ingresos,gastos,utilidadNeta:this.money(ingresos-gastos),detalle:detail };
  }

  async getBalanceGeneral(fecha?: string) {
    const end = fecha || new Date().toISOString().slice(0, 10);
    const detail = await queryRows<{ tipo: string; codigo: string; nombre: string; saldo: string | number }>(this.dataSource, `
      SELECT c.tipo,c.codigo,c.nombre,CASE WHEN c.tipo='Activo' THEN sum(d.debe-d.haber) ELSE sum(d.haber-d.debe) END AS saldo
      FROM poliza_contable_detalle d JOIN poliza_contable p ON p.id_poliza=d.id_poliza
      JOIN cuenta_contable c ON c.id_cuenta=d.id_cuenta
      WHERE p.estado='Contabilizada' AND p.fecha<=$1::date AND c.tipo IN ('Activo','Pasivo','Capital')
      GROUP BY c.id_cuenta ORDER BY c.codigo`, [end]);
    const result = await queryRows<{ saldo: string | number }>(this.dataSource, `SELECT coalesce(sum(CASE
      WHEN c.tipo='Ingreso' THEN d.haber-d.debe WHEN c.tipo='Gasto' THEN d.haber-d.debe ELSE 0 END),0) AS saldo
      FROM poliza_contable_detalle d JOIN poliza_contable p ON p.id_poliza=d.id_poliza
      JOIN cuenta_contable c ON c.id_cuenta=d.id_cuenta
      WHERE p.estado='Contabilizada' AND p.fecha<=$1::date AND c.tipo IN ('Ingreso','Gasto')`, [end]);
    const sum = (type: string) => this.money(detail.filter(x=>x.tipo===type).reduce((s,x)=>s+Number(x.saldo),0));
    const activos=sum('Activo'),pasivos=sum('Pasivo'),capitalBase=sum('Capital');
    const resultadoAcumulado=this.money(Number(result[0]?.saldo || 0));
    const capital=this.money(capitalBase+resultadoAcumulado);
    return { fecha:end,activos,pasivos,capitalBase,resultadoAcumulado,capital,
      diferencia:this.money(activos-pasivos-capital),detalle:[...detail,
        {tipo:'Capital',codigo:'3999',nombre:'Resultado acumulado',saldo:resultadoAcumulado}] };
  }

  async getCuentasTesoreria() {
    return queryRows<Record<string, unknown>>(this.dataSource, `SELECT c.id_cuenta AS "idCuenta",c.nombre,c.banco,c.moneda,
      c.ultimos_cuatro AS "ultimosCuatro",c.saldo_inicial AS "saldoInicial",c.activa,
      c.saldo_inicial+coalesce(sum(m.monto),0) AS saldo,
      count(m.id_movimiento) FILTER(WHERE m.estado='Pendiente')::int AS pendientes
      FROM tesoreria_cuenta c LEFT JOIN tesoreria_movimiento m ON m.id_cuenta=c.id_cuenta
      GROUP BY c.id_cuenta ORDER BY c.activa DESC,c.nombre`);
  }

  async crearCuentaTesoreria(dto: CreateCuentaTesoreriaDto) {
    const rows = await queryRows<{ idCuenta: number }>(this.dataSource, `INSERT INTO tesoreria_cuenta(nombre,banco,moneda,ultimos_cuatro,saldo_inicial)
      VALUES($1,$2,$3,$4,$5) RETURNING id_cuenta AS "idCuenta"`,
      [dto.nombre,dto.banco,dto.moneda,dto.ultimosCuatro || null,dto.saldoInicial]);
    return { message:'Cuenta de tesorería creada',idCuenta:rows[0].idCuenta };
  }

  async getMovimientosTesoreria(idCuenta?: number) {
    return queryRows<Record<string, unknown>>(this.dataSource, `SELECT m.id_movimiento AS "idMovimiento",m.id_cuenta AS "idCuenta",
      c.nombre AS cuenta,c.banco,m.fecha,m.descripcion,m.referencia,m.monto,m.estado,m.metodo_conciliacion AS "metodoConciliacion",
      m.puntaje_conciliacion AS "puntajeConciliacion",m.observaciones,m.id_importacion AS "idImportacion",
      m.id_caja_movimiento AS "idCajaMovimiento",m.conciliado_at AS "conciliadoAt",u.username AS "conciliadoPor"
      FROM tesoreria_movimiento m JOIN tesoreria_cuenta c ON c.id_cuenta=m.id_cuenta
      LEFT JOIN auth_user u ON u.id_user=m.conciliado_por
      WHERE ($1::int IS NULL OR m.id_cuenta=$1) ORDER BY m.fecha DESC,m.id_movimiento DESC LIMIT 500`, [idCuenta || null]);
  }

  async crearMovimientoTesoreria(dto: CreateMovimientoTesoreriaDto) {
    if (this.money(dto.monto) === 0) throw new BadRequestException('El monto del movimiento no puede ser cero');
    const rows = await queryRows<{ idMovimiento: number }>(this.dataSource, `INSERT INTO tesoreria_movimiento(id_cuenta,fecha,descripcion,referencia,monto)
      SELECT id_cuenta,$2,$3,$4,$5 FROM tesoreria_cuenta WHERE id_cuenta=$1 AND activa
      RETURNING id_movimiento AS "idMovimiento"`, [dto.idCuenta,dto.fecha,dto.descripcion,dto.referencia || null,dto.monto]);
    if (!rows.length) throw new NotFoundException('Cuenta de tesorería no encontrada o inactiva');
    return { message:'Movimiento bancario importado',idMovimiento:rows[0].idMovimiento };
  }

  async importarEstadoCuenta(dto:ImportBankStatementDto,file?:Express.Multer.File,idUsuario?:number) {
    if(!file)throw new BadRequestException('Selecciona un archivo CSV');
    if(!['text/csv','text/plain','application/csv','application/vnd.ms-excel','application/octet-stream'].includes(file.mimetype)) {
      throw new BadRequestException('El estado de cuenta debe ser un archivo CSV');
    }
    const parsed=parseBankStatementCsv(file.buffer);
    if(!parsed.rows.length)throw new BadRequestException('El archivo no contiene movimientos válidos');
    const sha256=createHash('sha256').update(file.buffer).digest('hex');
    return this.dataSource.transaction(async manager=>{
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext('bank-import:'||$1))`,[dto.requestId]);
      const previous=await queryRows<{idImportacion:number;insertados:number;duplicados:number;conciliadosAuto:number}>(manager,
        `SELECT id_importacion AS "idImportacion",insertados,duplicados,conciliados_auto AS "conciliadosAuto"
         FROM tesoreria_importacion WHERE request_id=$1 OR (id_cuenta=$2 AND sha256=$3) ORDER BY id_importacion LIMIT 1`,[dto.requestId,dto.idCuenta,sha256]);
      if(previous.length)return{...previous[0],repeated:true,errores:parsed.errors};
      const account=await queryRows<{id:number}>(manager,'SELECT id_cuenta AS id FROM tesoreria_cuenta WHERE id_cuenta=$1 AND activa FOR SHARE',[dto.idCuenta]);
      if(!account.length)throw new NotFoundException('Cuenta de tesorería no encontrada o inactiva');
      const imports=await queryRows<{id:number}>(manager,`INSERT INTO tesoreria_importacion(request_id,id_cuenta,nombre_archivo,sha256,total_renglones,errores,id_user)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id_importacion AS id`,
      [dto.requestId,dto.idCuenta,file.originalname.slice(0,255),sha256,parsed.rows.length+parsed.errors.length,JSON.stringify(parsed.errors.slice(0,100)),idUsuario||null]);
      let inserted=0,duplicates=0,matched=0;
      const occurrences=new Map<string,number>();
      for(const row of parsed.rows){
        const signature=`${row.date}|${row.amount.toFixed(2)}|${(row.reference||'').toUpperCase()}|${row.description.toUpperCase()}`;
        const occurrence=(occurrences.get(signature)||0)+1;occurrences.set(signature,occurrence);
        const fingerprint=createHash('sha256').update(`${dto.idCuenta}|${signature}|${occurrence}`).digest('hex');
        const created=await queryRows<{id:number}>(manager,`INSERT INTO tesoreria_movimiento(id_cuenta,fecha,descripcion,referencia,monto,id_importacion,fingerprint)
          VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id_movimiento AS id`,
        [dto.idCuenta,row.date,row.description,row.reference||null,row.amount,imports[0].id,fingerprint]);
        if(!created.length){duplicates++;continue} inserted++;
        if(dto.autoConciliar){
          const candidates=await queryRows<{id:number}>(manager,`SELECT cm.id_movimiento AS id FROM caja_movimiento cm
            WHERE cm.banco=$2::numeric AND cm.fecha::date BETWEEN $1::date-3 AND $1::date+3
              AND NOT EXISTS(SELECT 1 FROM tesoreria_movimiento tm WHERE tm.id_caja_movimiento=cm.id_movimiento)
            ORDER BY abs(cm.fecha::date-$1::date),cm.id_movimiento FOR UPDATE OF cm`,[row.date,row.amount]);
          if(candidates.length===1){
            await manager.query(`UPDATE tesoreria_movimiento SET estado='Conciliado',id_caja_movimiento=$2,conciliado_por=$3,
              conciliado_at=clock_timestamp(),metodo_conciliacion='Automatica',puntaje_conciliacion=100,updated_at=clock_timestamp()
              WHERE id_movimiento=$1`,[created[0].id,candidates[0].id,idUsuario||null]);
            matched++;
          }
        }
      }
      await manager.query(`UPDATE tesoreria_importacion SET insertados=$2,duplicados=$3,conciliados_auto=$4 WHERE id_importacion=$1`,
        [imports[0].id,inserted,duplicates,matched]);
      return{idImportacion:imports[0].id,insertados:inserted,duplicados:duplicates,conciliadosAuto:matched,errores:parsed.errors};
    });
  }

  getImportaciones(idCuenta?:number) {
    return queryRows<Record<string,unknown>>(this.dataSource,`SELECT i.id_importacion AS "idImportacion",i.id_cuenta AS "idCuenta",c.nombre AS cuenta,
      i.nombre_archivo AS "nombreArchivo",i.total_renglones AS "totalRenglones",i.insertados,i.duplicados,
      i.conciliados_auto AS "conciliadosAuto",jsonb_array_length(i.errores) AS errores,i.created_at AS "createdAt",u.username AS usuario
      FROM tesoreria_importacion i JOIN tesoreria_cuenta c ON c.id_cuenta=i.id_cuenta LEFT JOIN auth_user u ON u.id_user=i.id_user
      WHERE($1::int IS NULL OR i.id_cuenta=$1) ORDER BY i.created_at DESC LIMIT 100`,[idCuenta||null]);
  }

  async getCandidatosConciliacion(idMovimiento: number) {
    const movement = await queryRows<{ fecha: string; monto: string | number }>(this.dataSource,
      `SELECT fecha,monto FROM tesoreria_movimiento WHERE id_movimiento=$1 AND estado='Pendiente'`, [idMovimiento]);
    if (!movement.length) throw new NotFoundException('Movimiento pendiente no encontrado');
    return queryRows<Record<string, unknown>>(this.dataSource, `SELECT cm.id_movimiento AS "idCajaMovimiento",cm.fecha,cm.banco AS monto,
      cm.saldo_banco AS "saldoBanco",cm.origen,u.username AS usuario,
      abs(cm.banco-$2::numeric) AS diferencia,abs(cm.fecha::date-$1::date) AS dias,
      greatest(0,100-abs(cm.fecha::date-$1::date)*5-least(abs(cm.banco-$2::numeric),100)) AS puntaje
      FROM caja_movimiento cm LEFT JOIN auth_user u ON u.id_user=cm.id_usuario
      WHERE cm.banco<>0 AND NOT EXISTS(SELECT 1 FROM tesoreria_movimiento tm WHERE tm.id_caja_movimiento=cm.id_movimiento)
        AND cm.fecha::date BETWEEN $1::date-7 AND $1::date+7
      ORDER BY abs(cm.banco-$2::numeric),abs(cm.fecha::date-$1::date),cm.id_movimiento LIMIT 20`,
      [movement[0].fecha,movement[0].monto]);
  }

  async conciliarMovimiento(idMovimiento: number, dto: ConciliarMovimientoDto, idUsuario?: number) {
    const result = await this.dataSource.transaction(async manager => {
      const movement = await queryRows<{ monto: string | number }>(manager,
        `SELECT monto FROM tesoreria_movimiento WHERE id_movimiento=$1 AND estado='Pendiente' FOR UPDATE`, [idMovimiento]);
      if (!movement.length) throw new NotFoundException('Movimiento pendiente no encontrado');
      const system = await queryRows<{ banco: string | number }>(manager,
        `SELECT banco FROM caja_movimiento WHERE id_movimiento=$1 AND banco<>0
          AND NOT EXISTS(SELECT 1 FROM tesoreria_movimiento WHERE id_caja_movimiento=$1) FOR SHARE`, [dto.idCajaMovimiento]);
      if (!system.length) throw new NotFoundException('Movimiento del sistema no disponible');
      if (this.money(Number(movement[0].monto)) !== this.money(Number(system[0].banco))) {
        throw new BadRequestException('Los montos deben coincidir para conciliar');
      }
      await manager.query(`UPDATE tesoreria_movimiento SET estado='Conciliado',id_caja_movimiento=$2,
        conciliado_por=$3,conciliado_at=clock_timestamp(),metodo_conciliacion='Manual',puntaje_conciliacion=100,
        observaciones=NULL,updated_at=clock_timestamp() WHERE id_movimiento=$1`,
        [idMovimiento,dto.idCajaMovimiento,idUsuario || null]);
      return { message:'Movimiento conciliado' };
    });
    return result;
  }

  async desconciliarMovimiento(idMovimiento:number,motivo:string) {
    const rows=await queryRows<{id:number}>(this.dataSource,`UPDATE tesoreria_movimiento SET estado='Pendiente',id_caja_movimiento=NULL,
      conciliado_por=NULL,conciliado_at=NULL,metodo_conciliacion=NULL,puntaje_conciliacion=NULL,observaciones=$2,updated_at=clock_timestamp()
      WHERE id_movimiento=$1 AND estado='Conciliado' RETURNING id_movimiento AS id`,[idMovimiento,`Desconciliado: ${motivo}`]);
    if(!rows.length)throw new ConflictException('El movimiento no está conciliado');
    return{message:'Conciliación revertida'};
  }

  async ignorarMovimiento(idMovimiento:number,motivo:string) {
    const rows=await queryRows<{id:number}>(this.dataSource,`UPDATE tesoreria_movimiento SET estado='Ignorado',observaciones=$2,
      updated_at=clock_timestamp() WHERE id_movimiento=$1 AND estado='Pendiente' RETURNING id_movimiento AS id`,[idMovimiento,motivo]);
    if(!rows.length)throw new ConflictException('El movimiento no está pendiente');
    return{message:'Movimiento marcado como ignorado'};
  }

  async getPeriodos() {
    return queryRows<Record<string, unknown>>(this.dataSource, `SELECT p.id_periodo AS "idPeriodo",p.anio,p.mes,
      p.fecha_inicio AS "fechaInicio",p.fecha_fin AS "fechaFin",p.estado,p.cerrado_at AS "cerradoAt",u.username AS "cerradoPor",
      count(pc.id_poliza)::int AS polizas
      FROM periodo_contable p LEFT JOIN auth_user u ON u.id_user=p.cerrado_por
      LEFT JOIN poliza_contable pc ON pc.fecha BETWEEN p.fecha_inicio AND p.fecha_fin
      GROUP BY p.id_periodo,u.username ORDER BY p.anio DESC,p.mes DESC`);
  }

  async crearPeriodo(dto: CreatePeriodoDto) {
    const rows = await queryRows<{ idPeriodo: number }>(this.dataSource, `INSERT INTO periodo_contable(anio,mes)
      VALUES($1,$2) ON CONFLICT(anio,mes) DO UPDATE SET anio=EXCLUDED.anio
      RETURNING id_periodo AS "idPeriodo"`, [dto.anio,dto.mes]);
    return { message:'Periodo contable disponible',idPeriodo:rows[0].idPeriodo };
  }

  async cerrarPeriodo(idPeriodo: number, idUsuario?: number) {
    if (!idUsuario) throw new BadRequestException('Se requiere un usuario registrado para cerrar el periodo');
    return this.dataSource.transaction(async manager => {
      const period = await queryRows<{ fechaInicio: string; fechaFin: string; estado: string }>(manager, `SELECT fecha_inicio AS "fechaInicio",
        fecha_fin AS "fechaFin",estado FROM periodo_contable WHERE id_periodo=$1 FOR UPDATE`, [idPeriodo]);
      if (!period.length) throw new NotFoundException('Periodo no encontrado');
      if (period[0].estado === 'Cerrado') throw new BadRequestException('El periodo ya está cerrado');
      const drafts = await queryRows<{ total: string | number }>(manager, `SELECT count(*) AS total FROM poliza_contable
        WHERE fecha BETWEEN $1 AND $2 AND estado='Borrador'`, [period[0].fechaInicio,period[0].fechaFin]);
      if (Number(drafts[0].total)>0) throw new BadRequestException('Contabiliza o cancela todas las pólizas en borrador antes de cerrar');
      const unbalanced = await queryRows<{ total: string | number }>(manager, `SELECT count(*) AS total FROM (SELECT p.id_poliza
        FROM poliza_contable p JOIN poliza_contable_detalle d ON d.id_poliza=p.id_poliza
        WHERE p.fecha BETWEEN $1 AND $2 AND p.estado='Contabilizada' GROUP BY p.id_poliza HAVING sum(d.debe)<>sum(d.haber)) x`,
        [period[0].fechaInicio,period[0].fechaFin]);
      if(Number(unbalanced[0].total)>0) throw new BadRequestException('Existen pólizas descuadradas en el periodo');
      await manager.query(`UPDATE periodo_contable SET estado='Cerrado',cerrado_por=$2,cerrado_at=clock_timestamp() WHERE id_periodo=$1`, [idPeriodo,idUsuario]);
      return { message:'Periodo contable cerrado' };
    });
  }

  async getCentrosCosto() {
    return queryRows<Record<string, unknown>>(this.dataSource, `SELECT id_centro AS "idCentroCosto",codigo,nombre,activo
      FROM centro_costo ORDER BY activo DESC,codigo`);
  }

  async getPresupuestos(query: PresupuestoQueryDto) {
    return queryRows<Record<string, unknown>>(this.dataSource, `SELECT b.id_presupuesto AS "idPresupuesto",b.anio,b.mes,
      c.id_cuenta AS "idCuenta",c.codigo,c.nombre AS cuenta,cc.id_centro AS "idCentroCosto",cc.nombre AS centro,
      b.monto,b.notas,coalesce(sum(CASE WHEN p.id_poliza IS NULL THEN 0 WHEN c.tipo='Ingreso' THEN d.haber-d.debe ELSE d.debe-d.haber END),0) AS real,
      b.monto-coalesce(sum(CASE WHEN p.id_poliza IS NULL THEN 0 WHEN c.tipo='Ingreso' THEN d.haber-d.debe ELSE d.debe-d.haber END),0) AS variacion
      FROM presupuesto_contable b JOIN cuenta_contable c ON c.id_cuenta=b.id_cuenta
      LEFT JOIN centro_costo cc ON cc.id_centro=b.id_centro_costo
      LEFT JOIN poliza_contable_detalle d ON d.id_cuenta=b.id_cuenta AND (b.id_centro_costo IS NULL OR d.id_centro_costo=b.id_centro_costo)
      LEFT JOIN poliza_contable p ON p.id_poliza=d.id_poliza AND p.estado='Contabilizada'
        AND extract(year FROM p.fecha)=$1 AND extract(month FROM p.fecha)=$2
      WHERE b.anio=$1 AND b.mes=$2 GROUP BY b.id_presupuesto,c.id_cuenta,cc.id_centro ORDER BY c.codigo,cc.nombre NULLS FIRST`,
      [query.anio,query.mes]);
  }

  async guardarPresupuesto(dto: UpsertPresupuestoDto) {
    const account = await queryRows<{ id_cuenta: number }>(this.dataSource, `SELECT id_cuenta FROM cuenta_contable
      WHERE id_cuenta=$1 AND activa AND acepta_movimientos`, [dto.idCuenta]);
    if(!account.length) throw new NotFoundException('Cuenta contable no disponible');
    if(dto.idCentroCosto) {
      const center=await queryRows<{ id_centro: number }>(this.dataSource, `SELECT id_centro FROM centro_costo WHERE id_centro=$1 AND activo`, [dto.idCentroCosto]);
      if(!center.length) throw new NotFoundException('Centro de costo no disponible');
      await this.dataSource.query(`INSERT INTO presupuesto_contable(anio,mes,id_cuenta,id_centro_costo,monto,notas)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(anio,mes,id_cuenta,id_centro_costo) WHERE id_centro_costo IS NOT NULL
        DO UPDATE SET monto=EXCLUDED.monto,notas=EXCLUDED.notas,updated_at=clock_timestamp()`,
        [dto.anio,dto.mes,dto.idCuenta,dto.idCentroCosto,dto.monto,dto.notas || null]);
    } else {
      await this.dataSource.query(`INSERT INTO presupuesto_contable(anio,mes,id_cuenta,monto,notas)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(anio,mes,id_cuenta) WHERE id_centro_costo IS NULL
        DO UPDATE SET monto=EXCLUDED.monto,notas=EXCLUDED.notas,updated_at=clock_timestamp()`,
        [dto.anio,dto.mes,dto.idCuenta,dto.monto,dto.notas || null]);
    }
    return { message:'Presupuesto actualizado' };
  }

  async getFlujoEfectivo(query: ContabilidadQueryDto) {
    this.validateDateRange(query.fechaInicio,query.fechaFin);
    const start=query.fechaInicio || new Date(new Date().getFullYear(),0,1).toISOString().slice(0,10);
    const end=query.fechaFin || new Date().toISOString().slice(0,10);
    const opening=await queryRows<{ saldo: string | number }>(this.dataSource, `SELECT coalesce(sum(d.debe-d.haber),0) AS saldo
      FROM poliza_contable_detalle d JOIN poliza_contable p ON p.id_poliza=d.id_poliza JOIN cuenta_contable c ON c.id_cuenta=d.id_cuenta
      WHERE p.estado='Contabilizada' AND p.fecha<$1 AND c.codigo IN('1100','1110')`, [start]);
    const detail=await queryRows<{ origen: string; ingresos: string | number; egresos: string | number; neto: string | number }>(this.dataSource, `SELECT
      coalesce(p.origen_tipo,'Póliza manual') AS origen,sum(d.debe) AS ingresos,sum(d.haber) AS egresos,sum(d.debe-d.haber) AS neto
      FROM poliza_contable_detalle d JOIN poliza_contable p ON p.id_poliza=d.id_poliza JOIN cuenta_contable c ON c.id_cuenta=d.id_cuenta
      WHERE p.estado='Contabilizada' AND p.fecha BETWEEN $1 AND $2 AND c.codigo IN('1100','1110')
      GROUP BY coalesce(p.origen_tipo,'Póliza manual') ORDER BY origen`, [start,end]);
    const saldoInicial=this.money(Number(opening[0]?.saldo||0));
    const ingresos=this.money(detail.reduce((s,x)=>s+Number(x.ingresos),0));
    const egresos=this.money(detail.reduce((s,x)=>s+Number(x.egresos),0));
    return {fechaInicio:start,fechaFin:end,saldoInicial,ingresos,egresos,flujoNeto:this.money(ingresos-egresos),
      saldoFinal:this.money(saldoInicial+ingresos-egresos),detalle:detail};
  }

  async exportarContabilidad(query: ExportarContabilidadDto) {
    let rows: Record<string, unknown>[];
    if(query.reporte==='balanza') rows=await this.getBalanza(query);
    else if(query.reporte==='resultados') {
      const result=await this.getEstadoResultados(query); rows=result.detalle;
    } else if(query.reporte==='balance') {
      const result=await this.getBalanceGeneral(query.fechaFin); rows=result.detalle;
    } else {
      const result=await this.getFlujoEfectivo(query); rows=result.detalle;
    }
    return this.toCsv(rows);
  }

  private toCsv(rows: Record<string, unknown>[]) {
    if(!rows.length) return '\uFEFFSin datos\r\n';
    const headers=Object.keys(rows[0]);
    const cell=(value:unknown) => {
      let text='';
      if(typeof value==='string') text=value;
      else if(typeof value==='number'||typeof value==='bigint'||typeof value==='boolean') text=value.toString();
      else if(value instanceof Date) text=value.toISOString();
      else if(value!==null&&value!==undefined) text=JSON.stringify(value) ?? '';
      if(/^[=+@-]/.test(text)) text=`'${text}`;
      return `"${text.replace(/"/g,'""')}"`;
    };
    return `\uFEFF${headers.map(cell).join(',')}\r\n${rows.map(row=>headers.map(key=>cell(row[key])).join(',')).join('\r\n')}\r\n`;
  }

  private validateDateRange(start?: string, end?: string) {
    if (start && end && start > end) throw new BadRequestException('La fecha inicial no puede ser posterior a la final');
  }

  private money(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100; }

  async generarCortePdf(fechaInicio?: string, fechaFin?: string): Promise<Buffer> {
    if (fechaInicio && fechaFin && fechaInicio > fechaFin) {
      throw new BadRequestException('La fecha inicial no puede ser posterior a la final');
    }
    try {
      const start = fechaInicio || new Date().toISOString().slice(0, 10);
      const end = fechaFin || start;
      const saldos = await this.saldoRepository.find();
      const saldoActual =
        saldos.length > 0 ? saldos[0] : { cajaChica: 0, cuentaBanco: 0 };

      // Sum of expenses by category (weekly scope or all-time for this base implementation)
      // Usually would receive dates, but following requirements: Income summary, Expense summary, Final balances
      const gastosRaw = await queryRows<GastoResumenRow>(this.dataSource,
        `SELECT categoria, SUM(monto) as total_gastado
           FROM gasto
          WHERE fecha::date BETWEEN $1::date AND $2::date
            AND NOT anulado
          GROUP BY categoria ORDER BY total_gastado DESC`,
        [start, end],
      );

      const proveedoresRaw = await queryRows<PagoProveedorResumenRow>(this.dataSource, `
        SELECT forma_pago, SUM(monto) AS total_pagado FROM pago_proveedor
         WHERE fecha_pago::date BETWEEN $1::date AND $2::date GROUP BY forma_pago`, [start, end]);

      const ingresosRaw = await queryRows<IngresoResumenRow>(this.dataSource,
        `SELECT p.forma_pago, SUM(p.monto) as total_ingreso
           FROM pago p
           JOIN factura f ON f.id_factura = p.id_factura
          WHERE p.fecha_pago::date BETWEEN $1::date AND $2::date
            AND f.estatus::text <> 'Cancelada'
          GROUP BY p.forma_pago ORDER BY total_ingreso DESC`,
        [start, end],
      );

      const printer = new PdfPrinter(fonts);

      const docDefinition: TDocumentDefinitions = {
        pageSize: 'LETTER',
        pageMargins: [40, 60, 40, 60],
        defaultStyle: { font: 'Helvetica' },
        content: [
          { text: 'Corte Financiero', style: 'header' },
          {
            text: `Periodo: ${start} a ${end} · Generado: ${new Date().toLocaleString('es-MX')}`,
            margin: [0, 0, 0, 20],
          },

          { text: 'Saldos Finales Esperados', style: 'subheader' },
          {
            table: {
              headerRows: 1,
              widths: ['*', '*'],
              body: [
                [
                  { text: 'Caja Chica (Efectivo)', style: 'tableHeader' },
                  {
                    text: 'Cuenta Banco (Transferencias)',
                    style: 'tableHeader',
                  },
                ],
                [
                  `$${Number(saldoActual.cajaChica).toFixed(2)}`,
                  `$${Number(saldoActual.cuentaBanco).toFixed(2)}`,
                ],
              ],
            },
            margin: [0, 0, 0, 20],
          },

          { text: 'Resumen de Ingresos', style: 'subheader' },
          {
            table: {
              headerRows: 1,
              widths: ['*', 'auto'],
              body: [
                [
                  { text: 'Forma de Pago', style: 'tableHeader' },
                  { text: 'Total Ingresado', style: 'tableHeader' },
                ],
                ...ingresosRaw.map((i) => [
                  i.forma_pago,
                  `$${Number(i.total_ingreso).toFixed(2)}`,
                ]),
              ],
            },
            margin: [0, 0, 0, 20],
          },

          { text: 'Resumen de Gastos por Categoría', style: 'subheader' },
          {
            table: {
              headerRows: 1,
              widths: ['*', 'auto'],
              body: [
                [
                  { text: 'Categoría', style: 'tableHeader' },
                  { text: 'Total Gastado', style: 'tableHeader' },
                ],
                ...gastosRaw.map((g) => [
                  g.categoria,
                  `$${Number(g.total_gastado).toFixed(2)}`,
                ]),
              ],
            },
          },
          { text: 'Pagos a Proveedores', style: 'subheader' },
          { table: { headerRows: 1, widths: ['*', 'auto'], body: [
              [{ text: 'Forma de Pago', style: 'tableHeader' }, { text: 'Total Pagado', style: 'tableHeader' }],
              ...proveedoresRaw.map((p) => [p.forma_pago, `$${Number(p.total_pagado).toFixed(2)}`]),
            ] } },
        ],
        styles: {
          header: {
            fontSize: 18,
            bold: true,
            alignment: 'center',
            margin: [0, 0, 0, 10],
          },
          subheader: { fontSize: 14, bold: true, margin: [0, 10, 0, 5] },
          tableHeader: { bold: true, fontSize: 12, color: 'black' },
        },
      };

      const pdfDoc = printer.createPdfKitDocument(docDefinition);

      return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
        pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
        pdfDoc.on('error', (err: Error) => reject(err));
        pdfDoc.end();
      });
    } catch (error) {
      console.error(error);
      throw new InternalServerErrorException(
        'Error al generar el PDF de finanzas',
      );
    }
  }
}
