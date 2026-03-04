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

@Injectable({
  providedIn: 'root',
})
export class FinanzasService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/finanzas`;

  crearGasto(gasto: Gasto) {
    return this.http.post(`${this.apiUrl}/gastos`, gasto);
  }

  getGastos() {
    return this.http.get<any[]>(`${this.apiUrl}/gastos`);
  }

  getSaldos() {
    return this.http.get<any[]>(`${this.apiUrl}/saldos`);
  }
}
