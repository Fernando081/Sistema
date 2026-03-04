// frontend/src/app/services/compra.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { CreateCompra, CompraResumen } from '../compra/compra.interface';

const API_URL = `${environment.apiBaseUrl}/compra`;

@Injectable({
  providedIn: 'root',
})
export class CompraService {
  constructor(private http: HttpClient) {}

  crearCompra(compra: CreateCompra): Observable<any> {
    return this.http.post(API_URL, compra);
  }
  getCompras(page: number = 1, limit: number = 1000): Observable<any> {
    return this.http.get<any>(`${API_URL}?page=${page}&limit=${limit}`);
  }

  getDetalleCompra(id: number): Observable<any[]> {
    return this.http.get<any[]>(`${API_URL}/${id}/detalle`);
  }
}
