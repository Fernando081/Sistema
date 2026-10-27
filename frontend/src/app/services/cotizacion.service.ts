import type { DirectoryQuery } from '../shared/remote-directory';
import { CotizacionPagina, CotizacionDetalle, ConvertirCotizacion } from './cotizacion-api.types';
import { VentaResultado } from './venta-api.types';
// frontend/src/app/services/cotizacion.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

const API_URL = `${environment.apiBaseUrl}/cotizacion`;

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

  crear(dto: CreateCotizacion): Observable<{ message: string; id: number }> {
    return this.http.post<{ message: string; id: number }>(API_URL, dto);
  }

  getAll(page = 1, limit = 10, term = '', sortBy = 'id', sortOrder = 'desc', estado = '', desde = '', hasta = ''): Observable<CotizacionPagina> {
    return this.http.get<CotizacionPagina>(API_URL, { params: { page, limit, term, sortBy, sortOrder, estado, desde, hasta } });
  }

  exportCsv(query: DirectoryQuery): Observable<Blob> {
    return this.http.get(`${API_URL}/exportar`, { params: { ...query }, responseType: 'blob' });
  }

  descargarPdf(id: number): Observable<Blob> {
    return this.http.get(`${API_URL}/${id}/pdf`, { responseType: 'blob' });
  }

  getById(id: number): Observable<CotizacionDetalle> {
    return this.http.get<CotizacionDetalle>(`${API_URL}/${id}`);
  }

  convertirCRM(id: number, payload: ConvertirCotizacion): Observable<VentaResultado> {
    return this.http.post<VentaResultado>(`${API_URL}/${id}/convertir`, payload);
  }
}