// frontend/src/app/services/cotizacion.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

const API_URL = 'https://glorious-space-goggles-9rxj6pr5w5p3xp9g-3000.app.github.dev/api/v1/cotizacion';

export interface ConceptoCotizacion {
  idProducto: number;
  descripcion: string;
  unidadDescripcion: string;
  cantidad: number;
  valorUnitario: number;
  importe: number;
  importeIva: number;
  importeRetIsr: number;
  // Auxiliares para UI
  codigo?: string;
  objetoImpuesto?: string;
  tasaIva?: number;
  aplicaRetencionIsr?: boolean;
}

export interface CreateCotizacion {
  idCliente: number;
  nombreReceptor: string;
  rfcReceptor: string;
  subtotal: number;
  totalImpuestos: number;
  totalRetenciones: number;
  total: number;
  conceptos: ConceptoCotizacion[];
}

@Injectable({ providedIn: 'root' })
export class CotizacionService {
  constructor(private http: HttpClient) {}

  crear(dto: CreateCotizacion): Observable<any> {
    return this.http.post(API_URL, dto);
  }

  getAll(): Observable<any[]> {
    return this.http.get<any[]>(API_URL);
  }

  descargarPdf(id: number): Observable<Blob> {
    return this.http.get(`${API_URL}/${id}/pdf`, { responseType: 'blob' });
  }

  convertirEnVenta(id: number): Observable<any> {
    return this.http.post(`${API_URL}/${id}/convertir`, {});
  }
}