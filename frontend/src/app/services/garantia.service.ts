import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type EstadoGarantia =
  | 'Recibida' | 'En revision' | 'Enviada proveedor' | 'Aprobada' | 'Rechazada' | 'Cerrada';

export interface Garantia {
  idGarantia: number;
  idFactura: number;
  idConcepto: number;
  estado: EstadoGarantia;
  motivo: string;
  resolucion?: string;
  cantidad: number;
  destinoProducto: string;
  factura: string;
  cliente: string;
  codigo: string;
  producto: string;
  proveedor?: string;
  responsable?: string;
  createdAt: string;
  fechaCompromiso: string;
}

export interface CreateGarantia {
  idFactura: number;
  idConcepto: number;
  cantidad: number;
  motivo: string;
  destinoProducto: string;
  evidencias?: string[];
  fechaCompromiso?: string;
}

@Injectable({ providedIn: 'root' })
export class GarantiaService {
  private readonly apiUrl = `${environment.apiBaseUrl}/garantias`;
  constructor(private readonly http: HttpClient) {}

  getAll(): Observable<Garantia[]> { return this.http.get<Garantia[]>(this.apiUrl); }
  create(dto: CreateGarantia) { return this.http.post(this.apiUrl, dto); }
  update(id: number, dto: Partial<Garantia>) {
    return this.http.patch(`${this.apiUrl}/${id}`, dto);
  }
}
