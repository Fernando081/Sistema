// frontend/src/app/services/compra.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CreateCompra, CompraResumen } from '../compra/compra.interface';

const API_URL = 'https://glorious-space-goggles-9rxj6pr5w5p3xp9g-3000.app.github.dev/api/v1/compra';

@Injectable({
  providedIn: 'root'
})
export class CompraService {

  constructor(private http: HttpClient) { }

  crearCompra(compra: CreateCompra): Observable<any> {
    return this.http.post(API_URL, compra);
  }
  getCompras(): Observable<CompraResumen[]> {
    return this.http.get<CompraResumen[]>(API_URL);
  }

  getDetalleCompra(id: number): Observable<any[]> {
    return this.http.get<any[]>(`${API_URL}/${id}/detalle`);
  }
}