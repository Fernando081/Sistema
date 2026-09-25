import { BadRequestException, Controller, Get, Post, Body, Res, Req, Query, Param, ParseIntPipe } from '@nestjs/common';
import { FinanzasService } from './finanzas.service';
import { BalanceQueryDto, ConciliarMovimientoDto, ContabilidadQueryDto, CorteFinancieroQueryDto, CreateCuentaTesoreriaDto, CreateGastoDto, CreateMovimientoTesoreriaDto, CreatePeriodoDto, CreatePolizaDto, ExportarContabilidadDto, PresupuestoQueryDto, UpsertPresupuestoDto } from './finanzas.dto';
import type { Response } from 'express';
import { Roles } from '../auth/roles.decorator';
import { RolUsuario } from '../common/enums/app.enums';
import { JwtPayload } from '../auth/auth.types';
import { Permissions } from '../auth/permissions.decorator';

@Controller('finanzas')
@Roles(RolUsuario.ADMIN)
export class FinanzasController {
  constructor(private readonly finanzasService: FinanzasService) {}

  @Post('gastos')
  async crearGasto(@Body() createGastoDto: CreateGastoDto, @Req() req: { user: JwtPayload }) {
    return this.finanzasService.crearGasto(createGastoDto, req.user?.idUser);
  }

  @Get('gastos')
  async findAllGastos() {
    return this.finanzasService.findAllGastos();
  }

  @Get('saldos')
  async getSaldos() {
    return this.finanzasService.getSaldos();
  }

  @Get('contabilidad/cuentas')
  getCuentasContables() {
    return this.finanzasService.getCuentasContables();
  }

  @Get('contabilidad/polizas')
  getPolizas(@Query() query: ContabilidadQueryDto) {
    return this.finanzasService.getPolizas(query);
  }

  @Post('contabilidad/polizas')
  @Permissions('contabilidad.operar')
  crearPoliza(@Body() dto: CreatePolizaDto, @Req() req: { user: JwtPayload }) {
    return this.finanzasService.crearPoliza(dto, req.user?.idUser);
  }

  @Post('contabilidad/polizas/:id/contabilizar')
  @Permissions('contabilidad.operar')
  contabilizarPoliza(@Param('id', ParseIntPipe) id: number) {
    return this.finanzasService.contabilizarPoliza(id);
  }

  @Get('contabilidad/balanza')
  getBalanza(@Query() query: ContabilidadQueryDto) {
    return this.finanzasService.getBalanza(query);
  }

  @Get('contabilidad/estado-resultados')
  getEstadoResultados(@Query() query: ContabilidadQueryDto) {
    return this.finanzasService.getEstadoResultados(query);
  }

  @Get('contabilidad/balance-general')
  getBalanceGeneral(@Query() query: BalanceQueryDto) {
    return this.finanzasService.getBalanceGeneral(query.fecha);
  }

  @Get('tesoreria/cuentas')
  getCuentasTesoreria() { return this.finanzasService.getCuentasTesoreria(); }

  @Post('tesoreria/cuentas')
  @Permissions('tesoreria.conciliar')
  crearCuentaTesoreria(@Body() dto: CreateCuentaTesoreriaDto) {
    return this.finanzasService.crearCuentaTesoreria(dto);
  }

  @Get('tesoreria/movimientos')
  getMovimientosTesoreria(@Query('idCuenta') idCuenta?: string) {
    const parsed = idCuenta ? Number(idCuenta) : undefined;
    if (parsed !== undefined && (!Number.isSafeInteger(parsed) || parsed < 1)) throw new BadRequestException('Cuenta inválida');
    return this.finanzasService.getMovimientosTesoreria(parsed);
  }

  @Post('tesoreria/movimientos')
  @Permissions('tesoreria.conciliar')
  crearMovimientoTesoreria(@Body() dto: CreateMovimientoTesoreriaDto) {
    return this.finanzasService.crearMovimientoTesoreria(dto);
  }

  @Get('tesoreria/movimientos/:id/candidatos')
  getCandidatosConciliacion(@Param('id', ParseIntPipe) id: number) {
    return this.finanzasService.getCandidatosConciliacion(id);
  }

  @Post('tesoreria/movimientos/:id/conciliar')
  @Permissions('tesoreria.conciliar')
  conciliarMovimiento(@Param('id', ParseIntPipe) id: number, @Body() dto: ConciliarMovimientoDto,
    @Req() req: { user: JwtPayload }) {
    return this.finanzasService.conciliarMovimiento(id,dto,req.user?.idUser);
  }

  @Get('contabilidad/periodos')
  getPeriodos() { return this.finanzasService.getPeriodos(); }

  @Post('contabilidad/periodos')
  @Permissions('contabilidad.operar')
  crearPeriodo(@Body() dto: CreatePeriodoDto) { return this.finanzasService.crearPeriodo(dto); }

  @Post('contabilidad/periodos/:id/cerrar')
  @Permissions('contabilidad.cerrar_periodo')
  cerrarPeriodo(@Param('id',ParseIntPipe) id:number,@Req() req:{user:JwtPayload}) {
    return this.finanzasService.cerrarPeriodo(id,req.user?.idUser);
  }

  @Get('contabilidad/centros-costo')
  getCentrosCosto() { return this.finanzasService.getCentrosCosto(); }

  @Get('contabilidad/presupuestos')
  getPresupuestos(@Query() query:PresupuestoQueryDto) { return this.finanzasService.getPresupuestos(query); }

  @Post('contabilidad/presupuestos')
  @Permissions('contabilidad.operar')
  guardarPresupuesto(@Body() dto:UpsertPresupuestoDto) { return this.finanzasService.guardarPresupuesto(dto); }

  @Get('contabilidad/flujo-efectivo')
  getFlujoEfectivo(@Query() query:ContabilidadQueryDto) { return this.finanzasService.getFlujoEfectivo(query); }

  @Get('contabilidad/exportar')
  async exportarContabilidad(@Query() query:ExportarContabilidadDto,@Res() res:Response) {
    const csv=await this.finanzasService.exportarContabilidad(query);
    res.set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${query.reporte}.csv"`});
    res.end(csv);
  }

  @Get('corte-pdf')
  async generarCortePdf(@Query() query: CorteFinancieroQueryDto, @Res() res: Response) {
    const buffer = await this.finanzasService.generarCortePdf(query.fechaInicio, query.fechaFin);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="corte-financiero.pdf"',
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
