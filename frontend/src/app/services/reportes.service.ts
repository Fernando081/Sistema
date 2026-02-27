import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ProductoUtilidad {
  idProducto: number;
  codigo: string;
  descripcion: string;
  cantidadVendida: number;
  ingresosTotales: number;
  costoTotal: number;
  utilidadNeta: number;
  margenPorcentaje: number;
}

const API_URL = `${environment.apiBaseUrl}/reportes`;

@Injectable({
  providedIn: 'root'
})
export class ReportesService {

  constructor(private http: HttpClient) { }

  getReporteUtilidad(): Observable<ProductoUtilidad[]> {
    return this.http.get<ProductoUtilidad[]>(`${API_URL}/utilidad`);
  }
}
