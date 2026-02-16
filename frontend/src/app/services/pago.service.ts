// frontend/src/app/services/pago.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

const API_URL = `${environment.apiBaseUrl}/pago`;

export interface PagoDto {
  idFactura: number;
  monto: number;
  formaPago: string;
  referencia?: string;
  notas?: string;
}

@Injectable({ providedIn: 'root' })
export class PagoService {
  constructor(private http: HttpClient) {}

  registrar(dto: PagoDto): Observable<any> {
    return this.http.post(API_URL, dto);
  }

  getPendientes(idCliente: number): Observable<any[]> {
    return this.http.get<any[]>(`${API_URL}/pendientes/${idCliente}`);
  }
}