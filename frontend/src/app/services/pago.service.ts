// frontend/src/app/services/pago.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

const API_URL = 'https://glorious-space-goggles-9rxj6pr5w5p3xp9g-3000.app.github.dev/api/v1/pago';

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