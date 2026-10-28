import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

const API_URL = `${environment.apiBaseUrl}/dashboard`;

export interface CategoriaVenta {
  categoria: string;
  ventas: number;
}

export interface HoraDiaVenta {
  dia: string;
  hora: number;
  ventas: number;
}

export interface VentasFacturacion {
  ingresos_brutos: string | number;
  ingresos_netos: string | number;
  ticket_promedio: string | number | null;
  margen_utilidad_bruta: string | number | null;
  ventas_por_categoria: CategoriaVenta[];
  comportamiento_hora_dia: HoraDiaVenta[];
  descuento_promedio_otorgado: string | number | null;
}

export interface LentoMovimiento {
  codigo: string;
  descripcion: string;
  dias_sin_ventas: number | null;
  existencia: number;
}

export interface HistoricoDato {
  mes: string;
  valor: number;
}

export interface InventarioAlmacen {
  valor_total_inventario: string | number | null;
  tasa_rotacion_inventario: string | number | null;
  indice_quiebre_stock: string | number;
  dias_inventario: string | number | null;
  mercancia_lento_movimiento: LentoMovimiento[];
  merma_shrinkage: string | number;
  shrinkage_historico_json: HistoricoDato[];
  retorno_inversion_inventario: string | number | null;
  gmroi_dias_historial?: number;
  costo_aterrizado: string | number | null;
}

export interface AgingReport {
  rango: string;
  monto: string | number;
}

export interface ClientesCobranza {
  tasa_retencion_clientes: string | number;
  cuentas_por_cobrar: AgingReport[];
  valor_tiempo_vida: string | number;
  dias_cuentas_por_pagar: string | number | null;
}

export interface RentabilidadProveedor {
  proveedor: string;
  marca: string;
  rentabilidad: string | number | null;
}

export interface DashboardMetrics {
  ventasHoy: number;
  ventasMes: number;
  porCobrar: number;
  porPagar: number;
  conteoBajos: number;
  grafica: { name: string; value: number }[];
  listaBajos: { codigo: string; descripcion: string; existencia: number }[];
  topProductos: { name: string; value: number }[];
}

export interface OperacionesAvanzadas {
  tasa_conversion_cotizaciones: string | number | null;
  tasa_devoluciones: string | number | null;
  tasa_de_devoluciones_historico: HistoricoDato[];
  rentabilidad_proveedor_marca: RentabilidadProveedor[];
  tasa_cumplimiento: string | number | null;
  indice_ventas_cruzadas: string | number | null;
}

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private http = inject(HttpClient);

  getRefreshStatus(): Observable<DashboardRefreshStatus> {
    return this.http.get<DashboardRefreshStatus>(`${API_URL}/refresh-status`);
  }

  getScheduledJobs(): Observable<ScheduledJobStatus[]> {
    return this.http.get<ScheduledJobStatus[]>(`${API_URL}/scheduled-jobs`);
  }

  getMetrics(): Observable<DashboardMetrics> {
    return this.http.get<DashboardMetrics>(API_URL);
  }

  getVentas(): Observable<VentasFacturacion[]> {
    return this.http.get<VentasFacturacion[]>(`${API_URL}/ventas`);
  }

  getInventario(): Observable<InventarioAlmacen[]> {
    return this.http.get<InventarioAlmacen[]>(`${API_URL}/inventario`);
  }

  getClientes(): Observable<ClientesCobranza[]> {
    return this.http.get<ClientesCobranza[]>(`${API_URL}/clientes`);
  }

  getOperaciones(): Observable<OperacionesAvanzadas[]> {
    return this.http.get<OperacionesAvanzadas[]>(`${API_URL}/operaciones`);
  }
}

export interface DashboardRefreshStatus {
  checkedAt: string;
  expectedAt: string;
  lastSuccessAt: string | null;
  overdue: boolean;
  freshness: 'current' | 'pending' | 'overdue';
  lastRun: { id: string; startedAt: string; finishedAt: string | null; status: 'running' | 'success' | 'failed' } | null;
  recentRuns: { id: string; startedAt: string; finishedAt: string | null; status: 'running' | 'success' | 'failed' }[];
}

export interface ScheduledJobStatus {
  name: 'operational_alerts' | 'dashboard_freshness' | 'crm_reports' | 'document_mail';
  checkedAt: string;
  expectedAt: string;
  lastSuccessAt: string | null;
  overdue: boolean;
  lastRun: DashboardRefreshStatus['lastRun'];
  recentRuns: DashboardRefreshStatus['recentRuns'];
}
