import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

export interface Gasto {
  concepto: string;
  monto: number;
  categoria: string;
  metodoPago: string;
  idCompra?: number;
}

export interface GastoRegistro extends Omit<Gasto, 'monto' | 'idCompra'> {
  idGasto: number; fecha: string; monto: number | string;
  idCompra: number | null; idUsuario: number | null; anulado: boolean; createdAt: string;
}
export interface SaldoActual {
  idSaldo: number; cajaChica: number | string; cuentaBanco: number | string; updatedAt: string;
}

export interface CuentaContable {
  idCuenta: number;
  codigo: string;
  nombre: string;
  tipo: 'Activo' | 'Pasivo' | 'Capital' | 'Ingreso' | 'Gasto';
  naturaleza: 'D' | 'A';
  aceptaMovimientos: boolean;
  activa: boolean;
}

export interface PolizaPartida {
  idDetalle?: number;
  idCuenta: number;
  idCentroCosto?: number;
  codigo?: string;
  cuenta?: string;
  concepto?: string;
  referencia?: string;
  debe: number;
  haber: number;
}

export interface PolizaContable {
  idPoliza: number;
  folio: number;
  fecha: string;
  tipo: 'Diario' | 'Ingreso' | 'Egreso';
  concepto: string;
  estado: 'Borrador' | 'Contabilizada' | 'Cancelada';
  origenTipo?: string;
  origenId?: number;
  automatica: boolean;
  usuario?: string;
  debe: number;
  haber: number;
  partidas: PolizaPartida[];
}

export interface BalanzaCuenta extends CuentaContable {
  saldoInicial: number;
  debe: number;
  haber: number;
  saldoFinal: number;
}

export interface EstadoResultados {
  fechaInicio: string;
  fechaFin: string;
  ingresos: number;
  gastos: number;
  utilidadNeta: number;
  detalle: Array<{ tipo: string; codigo: string; nombre: string; saldo: number }>;
}

/** F02a · Compras de contado sin pago contable y pólizas de ajuste propuestas (Borrador hasta que el contador decida). */
export interface AjusteProveedores {
  compras: { idCompra: number; fecha: string; proveedor: string; total: number; abonoProveedores: number; folioPoliza: number | null }[];
  total: number;
  ajustes: { idPoliza: number; folio: number; fecha: string; estado: 'Borrador' | 'Contabilizada'; total: number; compras: number[] }[];
}

/** F03 · DPO contable desde el mayor, con conciliaciones (no confundir con el plazo efectivo operativo de Q02). */
export interface DpoContable {
  periodo: { inicio: string; fin: string; dias: number };
  proveedores: { saldoInicial: number; saldoFinal: number; saldoMedio: number; compras: number; pagos: number; otrosAbonos: number };
  costoVentas: number;
  dpoCosto: number | null;
  dpoCompras: number | null;
  conciliacionProveedores: { aplica: boolean; motivo: string | null; mayor: number; auxiliar: number | null; diferencia: number;
    partidas: Array<{ concepto: string; importe: number }>; diferenciaExplicada?: boolean; causas?: string[] };
  conciliacionInventario: { saldoInicial: number; entradas: number; salidas: number; saldoFinal: number; costoVentas: number; diferenciaSalidasCosto: number };
  movimientos: Array<{ cuenta: string; origen: string; debe: number; haber: number }>;
  plazoEfectivoOperativo: number | null;
  advertencias: string[];
}

export interface BalanceGeneral {
  fecha: string;
  activos: number;
  pasivos: number;
  capitalBase: number;
  resultadoAcumulado: number;
  capital: number;
  diferencia: number;
  detalle: Array<{ tipo: string; codigo: string; nombre: string; saldo: number }>;
}

export interface CuentaTesoreria { idCuenta: number; nombre: string; banco: string; moneda: string; ultimosCuatro?: string; saldoInicial: number; saldo: number; activa: boolean; pendientes: number; }
export interface MovimientoTesoreria { idMovimiento: number; idCuenta: number; cuenta: string; banco: string; fecha: string; descripcion: string; referencia?: string; monto: number; estado: 'Pendiente' | 'Conciliado' | 'Ignorado'; idConciliacion?: number; conciliadoAt?: string; metodoConciliacion?:'Manual'|'Automatica'; puntajeConciliacion?:number; observaciones?:string; idImportacion?:number; }
export interface CandidatoConciliacion { idCajaMovimiento: number; fecha: string; monto: number; saldoBanco: number; origen: string; usuario?: string; diferencia: number; dias:number; puntaje:number; }
export interface ImportacionTesoreria { idImportacion:number;idCuenta:number;cuenta:string;nombreArchivo:string;totalRenglones:number;insertados:number;duplicados:number;conciliadosAuto:number;errores:number;createdAt:string;usuario?:string }
export interface ConciliacionTesoreria { idConciliacion:number;idCuenta?:number;cuenta?:string;tipo:'Exacta'|'Ajuste'|'Transferencia';estado:'Activa'|'Revertida';totalBanco:number;totalSistema:number;ajuste:number;tipoAjuste?:string;motivo?:string;createdAt:string;usuario?:string;movimientosBanco:number;movimientosSistema:number }
export interface CierreTesoreria { idCierre:number;idCuenta:number;cuenta:string;banco:string;anio:number;mes:number;saldoEstadoCuenta:number;saldoCalculado:number;movimientos:number;conciliados:number;ignorados:number;createdAt:string;usuario:string }
export interface PeriodoContable { idPeriodo: number; anio: number; mes: number; fechaInicio: string; fechaFin: string; estado: 'Abierto'|'Cerrado'; cerradoAt?: string; cerradoPor?: string; polizas: number; }
export interface CentroCosto { idCentroCosto: number; codigo: string; nombre: string; activo: boolean; }
export interface PresupuestoContable { idPresupuesto: number; anio: number; mes: number; idCuenta: number; codigo: string; cuenta: string; idCentroCosto?: number; centro?: string; monto: number; real: number; variacion: number; notas?: string; }
export interface FlujoEfectivo { fechaInicio: string; fechaFin: string; saldoInicial: number; ingresos: number; egresos: number; flujoNeto: number; saldoFinal: number; detalle: Array<{origen:string;ingresos:number;egresos:number;neto:number}>; }

@Injectable({
  providedIn: 'root',
})
export class FinanzasService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/finanzas`;

  crearGasto(gasto: Gasto) {
    return this.http.post<{ message: string }>(`${this.apiUrl}/gastos`, gasto);
  }

  getGastos() {
    return this.http.get<GastoRegistro[]>(`${this.apiUrl}/gastos`);
  }

  getSaldos() {
    return this.http.get<SaldoActual[]>(`${this.apiUrl}/saldos`);
  }

  getCortePdf() {
    return this.http.get(`${this.apiUrl}/corte-pdf`, { responseType: 'blob' });
  }

  getCuentasContables() {
    return this.http.get<CuentaContable[]>(`${this.apiUrl}/contabilidad/cuentas`);
  }

  getPolizas(fechaInicio: string, fechaFin: string, page = 1, limit = 50) {
    return this.http.get<{ data: PolizaContable[]; total: number; page: number; totalPages: number }>(
      `${this.apiUrl}/contabilidad/polizas`, { params: { fechaInicio, fechaFin, page, limit } },
    );
  }

  crearPoliza(payload: { fecha: string; tipo: string; concepto: string; partidas: PolizaPartida[] }) {
    return this.http.post<{ message: string; idPoliza: number }>(`${this.apiUrl}/contabilidad/polizas`, payload);
  }

  contabilizarPoliza(idPoliza: number) {
    return this.http.post(`${this.apiUrl}/contabilidad/polizas/${idPoliza}/contabilizar`, {});
  }

  getBalanza(fechaInicio: string, fechaFin: string) {
    return this.http.get<BalanzaCuenta[]>(`${this.apiUrl}/contabilidad/balanza`, { params: { fechaInicio, fechaFin } });
  }

  getEstadoResultados(fechaInicio: string, fechaFin: string) {
    return this.http.get<EstadoResultados>(`${this.apiUrl}/contabilidad/estado-resultados`, { params: { fechaInicio, fechaFin } });
  }

  getDpoContable(fechaInicio: string, fechaFin: string) {
    return this.http.get<DpoContable>(`${this.apiUrl}/contabilidad/dpo`, { params: { fechaInicio, fechaFin } });
  }

  getAjusteProveedores() {
    return this.http.get<AjusteProveedores>(`${this.apiUrl}/contabilidad/dpo/ajuste-proveedores`);
  }

  crearAjusteProveedores(body: { fecha: string; idCuentaContrapartida: number; motivo: string; compras: number[]; confirmacion: true }) {
    return this.http.post<{ idPoliza: number; folio: number; estado: 'Borrador'; compras: number; total: number }>(`${this.apiUrl}/contabilidad/dpo/ajuste-proveedores`, body);
  }

  getBalanceGeneral(fecha: string) {
    return this.http.get<BalanceGeneral>(`${this.apiUrl}/contabilidad/balance-general`, { params: { fecha } });
  }

  getCuentasTesoreria() { return this.http.get<CuentaTesoreria[]>(`${this.apiUrl}/tesoreria/cuentas`); }
  crearCuentaTesoreria(payload: { nombre: string; banco: string; moneda: string; ultimosCuatro?: string; saldoInicial: number }) {
    return this.http.post(`${this.apiUrl}/tesoreria/cuentas`, payload);
  }
  getMovimientosTesoreria() { return this.http.get<MovimientoTesoreria[]>(`${this.apiUrl}/tesoreria/movimientos`); }
  crearMovimientoTesoreria(payload: { idCuenta: number; fecha: string; descripcion: string; referencia?: string; monto: number }) {
    return this.http.post(`${this.apiUrl}/tesoreria/movimientos`, payload);
  }
  getCandidatosConciliacion(idMovimiento: number) {
    return this.http.get<CandidatoConciliacion[]>(`${this.apiUrl}/tesoreria/movimientos/${idMovimiento}/candidatos`);
  }
  conciliarMovimiento(idMovimiento: number, idCajaMovimiento: number) {
    return this.http.post(`${this.apiUrl}/tesoreria/movimientos/${idMovimiento}/conciliar`, { idCajaMovimiento });
  }
  importarEstadoCuenta(idCuenta:number,file:File,autoConciliar=true) {
    const data=new FormData();data.append('idCuenta',String(idCuenta));data.append('requestId',crypto.randomUUID());data.append('autoConciliar',String(autoConciliar));data.append('archivo',file);
    return this.http.post<{idImportacion:number;insertados:number;duplicados:number;conciliadosAuto:number;errores:Array<{line:number;message:string}>;repeated?:boolean}>(`${this.apiUrl}/tesoreria/importaciones`,data);
  }
  getImportacionesTesoreria(){return this.http.get<ImportacionTesoreria[]>(`${this.apiUrl}/tesoreria/importaciones`)}
  getConciliacionesTesoreria(){return this.http.get<ConciliacionTesoreria[]>(`${this.apiUrl}/tesoreria/conciliaciones`)}
  crearConciliacionTesoreria(payload:{movimientosBanco:number[];movimientosSistema:number[];tipoAjuste?:string;motivo?:string}){
    return this.http.post(`${this.apiUrl}/tesoreria/conciliaciones`,{requestId:crypto.randomUUID(),...payload})
  }
  getTransferenciasCandidatas(idMovimiento:number){return this.http.get<MovimientoTesoreria[]>(`${this.apiUrl}/tesoreria/movimientos/${idMovimiento}/transferencias-candidatas`)}
  crearTransferenciaTesoreria(idMovimientoSalida:number,idMovimientoEntrada:number,referencia?:string){
    return this.http.post(`${this.apiUrl}/tesoreria/transferencias`,{requestId:crypto.randomUUID(),idMovimientoSalida,idMovimientoEntrada,referencia})
  }
  getCierresTesoreria(){return this.http.get<CierreTesoreria[]>(`${this.apiUrl}/tesoreria/cierres`)}
  cerrarTesoreria(payload:{idCuenta:number;anio:number;mes:number;saldoEstadoCuenta:number}){return this.http.post(`${this.apiUrl}/tesoreria/cierres`,payload)}
  desconciliarMovimiento(idMovimiento:number,motivo:string){return this.http.post(`${this.apiUrl}/tesoreria/movimientos/${idMovimiento}/desconciliar`,{motivo})}
  ignorarMovimiento(idMovimiento:number,motivo:string){return this.http.post(`${this.apiUrl}/tesoreria/movimientos/${idMovimiento}/ignorar`,{motivo})}
  getPeriodos() { return this.http.get<PeriodoContable[]>(`${this.apiUrl}/contabilidad/periodos`); }
  crearPeriodo(anio:number,mes:number) { return this.http.post(`${this.apiUrl}/contabilidad/periodos`,{anio,mes}); }
  cerrarPeriodo(idPeriodo:number) { return this.http.post(`${this.apiUrl}/contabilidad/periodos/${idPeriodo}/cerrar`,{}); }
  getCentrosCosto() { return this.http.get<CentroCosto[]>(`${this.apiUrl}/contabilidad/centros-costo`); }
  getPresupuestos(anio:number,mes:number) { return this.http.get<PresupuestoContable[]>(`${this.apiUrl}/contabilidad/presupuestos`,{params:{anio,mes}}); }
  guardarPresupuesto(payload:{anio:number;mes:number;idCuenta:number;idCentroCosto?:number;monto:number;notas?:string}) {
    return this.http.post(`${this.apiUrl}/contabilidad/presupuestos`,payload);
  }
  getFlujoEfectivo(fechaInicio:string,fechaFin:string) { return this.http.get<FlujoEfectivo>(`${this.apiUrl}/contabilidad/flujo-efectivo`,{params:{fechaInicio,fechaFin}}); }
  exportarContabilidad(reporte:'balanza'|'resultados'|'balance'|'flujo',fechaInicio:string,fechaFin:string) {
    return this.http.get(`${this.apiUrl}/contabilidad/exportar`,{params:{reporte,fechaInicio,fechaFin,page:1,limit:100},responseType:'blob'});
  }
}
