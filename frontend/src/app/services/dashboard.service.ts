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
  ticket_promedio: string | number;
  margen_utilidad_bruta: string | number;
  ventas_por_categoria: CategoriaVenta[];
  comportamiento_hora_dia: HoraDiaVenta[];
  descuento_promedio_otorgado: string | number;
}

export interface LentoMovimiento {
  codigo: string;
  descripcion: string;
  dias_sin_ventas: number;
  existencia: number;
}

export interface HistoricoDato {
  mes: string;
  valor: number;
}

export interface InventarioAlmacen {
  valor_total_inventario: string | number;
  tasa_rotacion_inventario: string | number;
  indice_quiebre_stock: string | number;
  dias_inventario: string | number;
  mercancia_lento_movimiento: LentoMovimiento[];
  merma_shrinkage: string | number;
  shrinkage_historico_json: HistoricoDato[];
  retorno_inversion_inventario: string | number;
  costo_aterrizado: string | number;
}

export interface AgingReport {
  rango: string;
  monto: string | number;
}

export interface ClientesCobranza {
  tasa_retencion_clientes: string | number;
  cuentas_por_cobrar: AgingReport[];
  valor_tiempo_vida: string | number;
  dias_cuentas_por_pagar: string | number;
}

export interface RentabilidadProveedor {
  proveedor: string;
  marca: string;
  rentabilidad: string | number;
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
  tasa_conversion_cotizaciones: string | number;
  tasa_devoluciones: string | number;
  tasa_de_devoluciones_historico: HistoricoDato[];
  rentabilidad_proveedor_marca: RentabilidadProveedor[];
  tasa_cumplimiento: string | number;
  indice_ventas_cruzadas: string | number;
}

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private http = inject(HttpClient);

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
