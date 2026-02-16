// frontend/src/app/services/pago-proveedor.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// Ajusta la URL si tu entorno cambió
const API_URL = `${environment.apiBaseUrl}/pago-proveedor`;

export interface PagoProveedorDto {
  idCompra: number;
  monto: number;
  formaPago: string;
  referencia?: string;
  notas?: string;
}

@Injectable({ providedIn: 'root' })
export class PagoProveedorService {
  constructor(private http: HttpClient) {}

  registrar(dto: PagoProveedorDto): Observable<any> {
    return this.http.post(API_URL, dto);
  }

  getDeuda(idProveedor: number): Observable<any[]> {
    return this.http.get<any[]>(`${API_URL}/deuda/${idProveedor}`);
  }
}