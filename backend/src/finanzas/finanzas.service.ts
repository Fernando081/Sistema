// Fachada estable: conserva los contratos del controlador y delega por dominio.
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Gasto } from './entities/gasto.entity';
import { Saldo } from './entities/saldo.entity';
import { CreateGastoDto } from './finanzas.dto';
import { ContabilidadService } from './contabilidad.service';
import { ConciliacionService } from './conciliacion.service';
import { TesoreriaService } from './tesoreria.service';
import { TransferenciasCierresService } from './transferencias-cierres.service';
import { CorteFinancieroService } from './corte-financiero.service';

@Injectable()
export class FinanzasService {
  constructor(
    @InjectRepository(Gasto)
    private readonly gastoRepository: Repository<Gasto>,
    @InjectRepository(Saldo)
    private readonly saldoRepository: Repository<Saldo>,
    private readonly contabilidad: ContabilidadService,
    private readonly conciliacion: ConciliacionService,
    private readonly tesoreria: TesoreriaService,
    private readonly transferencias: TransferenciasCierresService,
    private readonly corte: CorteFinancieroService,
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
    return this.gastoRepository.find({
      where: { anulado: false },
      order: { fecha: 'DESC' },
    });
  }

  async getSaldos() {
    return this.saldoRepository.find();
  }

  getCuentasContables(
    ...args: Parameters<ContabilidadService['getCuentasContables']>
  ): ReturnType<ContabilidadService['getCuentasContables']> {
    return this.contabilidad.getCuentasContables(...args);
  }

  getPolizas(
    ...args: Parameters<ContabilidadService['getPolizas']>
  ): ReturnType<ContabilidadService['getPolizas']> {
    return this.contabilidad.getPolizas(...args);
  }

  crearPoliza(
    ...args: Parameters<ContabilidadService['crearPoliza']>
  ): ReturnType<ContabilidadService['crearPoliza']> {
    return this.contabilidad.crearPoliza(...args);
  }

  contabilizarPoliza(
    ...args: Parameters<ContabilidadService['contabilizarPoliza']>
  ): ReturnType<ContabilidadService['contabilizarPoliza']> {
    return this.contabilidad.contabilizarPoliza(...args);
  }

  getBalanza(
    ...args: Parameters<ContabilidadService['getBalanza']>
  ): ReturnType<ContabilidadService['getBalanza']> {
    return this.contabilidad.getBalanza(...args);
  }

  getEstadoResultados(
    ...args: Parameters<ContabilidadService['getEstadoResultados']>
  ): ReturnType<ContabilidadService['getEstadoResultados']> {
    return this.contabilidad.getEstadoResultados(...args);
  }

  getBalanceGeneral(
    ...args: Parameters<ContabilidadService['getBalanceGeneral']>
  ): ReturnType<ContabilidadService['getBalanceGeneral']> {
    return this.contabilidad.getBalanceGeneral(...args);
  }

  getPeriodos(
    ...args: Parameters<ContabilidadService['getPeriodos']>
  ): ReturnType<ContabilidadService['getPeriodos']> {
    return this.contabilidad.getPeriodos(...args);
  }

  crearPeriodo(
    ...args: Parameters<ContabilidadService['crearPeriodo']>
  ): ReturnType<ContabilidadService['crearPeriodo']> {
    return this.contabilidad.crearPeriodo(...args);
  }

  cerrarPeriodo(
    ...args: Parameters<ContabilidadService['cerrarPeriodo']>
  ): ReturnType<ContabilidadService['cerrarPeriodo']> {
    return this.contabilidad.cerrarPeriodo(...args);
  }

  getCentrosCosto(
    ...args: Parameters<ContabilidadService['getCentrosCosto']>
  ): ReturnType<ContabilidadService['getCentrosCosto']> {
    return this.contabilidad.getCentrosCosto(...args);
  }

  getPresupuestos(
    ...args: Parameters<ContabilidadService['getPresupuestos']>
  ): ReturnType<ContabilidadService['getPresupuestos']> {
    return this.contabilidad.getPresupuestos(...args);
  }

  guardarPresupuesto(
    ...args: Parameters<ContabilidadService['guardarPresupuesto']>
  ): ReturnType<ContabilidadService['guardarPresupuesto']> {
    return this.contabilidad.guardarPresupuesto(...args);
  }

  getFlujoEfectivo(
    ...args: Parameters<ContabilidadService['getFlujoEfectivo']>
  ): ReturnType<ContabilidadService['getFlujoEfectivo']> {
    return this.contabilidad.getFlujoEfectivo(...args);
  }

  exportarContabilidad(
    ...args: Parameters<ContabilidadService['exportarContabilidad']>
  ): ReturnType<ContabilidadService['exportarContabilidad']> {
    return this.contabilidad.exportarContabilidad(...args);
  }

  getCandidatosConciliacion(
    ...args: Parameters<ConciliacionService['getCandidatosConciliacion']>
  ): ReturnType<ConciliacionService['getCandidatosConciliacion']> {
    return this.conciliacion.getCandidatosConciliacion(...args);
  }

  conciliarMovimiento(
    ...args: Parameters<ConciliacionService['conciliarMovimiento']>
  ): ReturnType<ConciliacionService['conciliarMovimiento']> {
    return this.conciliacion.conciliarMovimiento(...args);
  }

  crearConciliacion(
    ...args: Parameters<ConciliacionService['crearConciliacion']>
  ): ReturnType<ConciliacionService['crearConciliacion']> {
    return this.conciliacion.crearConciliacion(...args);
  }

  getConciliaciones(
    ...args: Parameters<ConciliacionService['getConciliaciones']>
  ): ReturnType<ConciliacionService['getConciliaciones']> {
    return this.conciliacion.getConciliaciones(...args);
  }

  desconciliarMovimiento(
    ...args: Parameters<ConciliacionService['desconciliarMovimiento']>
  ): ReturnType<ConciliacionService['desconciliarMovimiento']> {
    return this.conciliacion.desconciliarMovimiento(...args);
  }

  ignorarMovimiento(
    ...args: Parameters<ConciliacionService['ignorarMovimiento']>
  ): ReturnType<ConciliacionService['ignorarMovimiento']> {
    return this.conciliacion.ignorarMovimiento(...args);
  }

  getCuentasTesoreria(
    ...args: Parameters<TesoreriaService['getCuentasTesoreria']>
  ): ReturnType<TesoreriaService['getCuentasTesoreria']> {
    return this.tesoreria.getCuentasTesoreria(...args);
  }

  crearCuentaTesoreria(
    ...args: Parameters<TesoreriaService['crearCuentaTesoreria']>
  ): ReturnType<TesoreriaService['crearCuentaTesoreria']> {
    return this.tesoreria.crearCuentaTesoreria(...args);
  }

  getMovimientosTesoreria(
    ...args: Parameters<TesoreriaService['getMovimientosTesoreria']>
  ): ReturnType<TesoreriaService['getMovimientosTesoreria']> {
    return this.tesoreria.getMovimientosTesoreria(...args);
  }

  crearMovimientoTesoreria(
    ...args: Parameters<TesoreriaService['crearMovimientoTesoreria']>
  ): ReturnType<TesoreriaService['crearMovimientoTesoreria']> {
    return this.tesoreria.crearMovimientoTesoreria(...args);
  }

  importarEstadoCuenta(
    ...args: Parameters<TesoreriaService['importarEstadoCuenta']>
  ): ReturnType<TesoreriaService['importarEstadoCuenta']> {
    return this.tesoreria.importarEstadoCuenta(...args);
  }

  getImportaciones(
    ...args: Parameters<TesoreriaService['getImportaciones']>
  ): ReturnType<TesoreriaService['getImportaciones']> {
    return this.tesoreria.getImportaciones(...args);
  }

  getTransferCandidates(
    ...args: Parameters<TransferenciasCierresService['getTransferCandidates']>
  ): ReturnType<TransferenciasCierresService['getTransferCandidates']> {
    return this.transferencias.getTransferCandidates(...args);
  }

  crearTransferencia(
    ...args: Parameters<TransferenciasCierresService['crearTransferencia']>
  ): ReturnType<TransferenciasCierresService['crearTransferencia']> {
    return this.transferencias.crearTransferencia(...args);
  }

  getCierres(
    ...args: Parameters<TransferenciasCierresService['getCierres']>
  ): ReturnType<TransferenciasCierresService['getCierres']> {
    return this.transferencias.getCierres(...args);
  }

  cerrarTesoreria(
    ...args: Parameters<TransferenciasCierresService['cerrarTesoreria']>
  ): ReturnType<TransferenciasCierresService['cerrarTesoreria']> {
    return this.transferencias.cerrarTesoreria(...args);
  }

  generarCortePdf(
    ...args: Parameters<CorteFinancieroService['generarCortePdf']>
  ): ReturnType<CorteFinancieroService['generarCortePdf']> {
    return this.corte.generarCortePdf(...args);
  }
}
