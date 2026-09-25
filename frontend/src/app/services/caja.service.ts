import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

export interface TurnoCaja {
  id_turno: number; estado: 'Abierta'|'Cerrada'; apertura: string; cierre?: string;
  responsable: string; contado_apertura: number; saldo_sistema_apertura: number;
  esperado_actual?: number; esperado_cierre?: number; contado_cierre?: number;
  diferencia?: number; notas_apertura?: string; notas_cierre?: string;
}
export interface MovimientoCaja {
  id_movimiento: string; fecha: string; efectivo: number; banco: number;
  saldo_efectivo: number; saldo_banco: number; usuario?: string; origen: string;
}
export interface ResumenCaja {
  saldo: { caja_chica: number; cuenta_banco: number };
  turno: TurnoCaja|null; totales: { entradas: number; salidas: number }; historial: TurnoCaja[];
}

@Injectable({providedIn:'root'})
export class CajaService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiBaseUrl}/caja`;
  resumen() { return this.http.get<ResumenCaja>(this.url); }
  abrir(contado: number, notas: string) { return this.http.post<TurnoCaja>(`${this.url}/abrir`,{contado,notas}); }
  cerrar(id: number, contado: number, notas: string) { return this.http.post<TurnoCaja>(`${this.url}/${id}/cerrar`,{contado,notas}); }
  movimientos(id: number,page: number) {
    return this.http.get<{data:MovimientoCaja[];total:number}>(`${this.url}/${id}/movimientos`,{params:{page}});
  }
}
