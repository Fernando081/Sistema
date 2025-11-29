// frontend/src/app/services/dashboard.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

const API_URL = 'https://glorious-space-goggles-9rxj6pr5w5p3xp9g-3000.app.github.dev/api/v1/dashboard';

export interface DashboardMetrics {
  ventasHoy: number;
  ventasMes: number;
  conteoBajos: number;
  grafica: { name: string; value: number }[];
  listaBajos: { codigo: string; descripcion: string; existencia: number }[];
}

@Injectable({ providedIn: 'root' })
export class DashboardService {
  constructor(private http: HttpClient) {}

  getMetrics(): Observable<DashboardMetrics> {
    return this.http.get<DashboardMetrics>(API_URL);
  }
}