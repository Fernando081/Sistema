// frontend/src/app/services/dashboard.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// La URL base del API proviene de los archivos de entorno (environment.*.ts); aquí solo se añade el path de dashboard.
const API_URL = `${environment.apiBaseUrl}/dashboard`;

export interface DashboardMetrics {
  ventasHoy: number;
  ventasMes: number;
  porCobrar: number; // <--- NUEVO (Activos)
  porPagar: number;  // <--- NUEVO (Pasivos)
  conteoBajos: number;
  grafica: { name: string; value: number }[];
  listaBajos: { codigo: string; descripcion: string; existencia: number }[];
  topProductos: { name: string; value: number }[];
}

@Injectable({ providedIn: 'root' })
export class DashboardService {
  constructor(private http: HttpClient) {}

  getMetrics(): Observable<DashboardMetrics> {
    return this.http.get<DashboardMetrics>(API_URL);
  }
}