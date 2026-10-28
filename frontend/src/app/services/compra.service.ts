import type { DirectoryQuery } from '../shared/remote-directory';
// frontend/src/app/services/compra.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { CreateCompra, DetalleCompraDb } from '../compra/compra.interface';

import { CompraResultado, CompraPagina } from './compra-api.types';

const API_URL = `${environment.apiBaseUrl}/compra`;

@Injectable({
  providedIn: 'root',
})
export class CompraService {
  constructor(private http: HttpClient) {}

  crearCompra(compra: CreateCompra): Observable<CompraResultado> {
    return this.http.post<CompraResultado>(API_URL, compra);
  }
  getCompras(page = 1, limit = 10, term = '', sortBy = '', sortOrder = '', estado = '', desde = '', hasta = ''): Observable<CompraPagina> {
    return this.http.get<CompraPagina>(API_URL, { params: { page, limit, term, sortBy, sortOrder, estado, desde, hasta } });
  }

  exportCsv(query: DirectoryQuery): Observable<Blob> {
    return this.http.get(`${API_URL}/exportar`, { params: { page: query.page, limit: query.limit, term: query.term, sortBy: this.sortKey(query.sortBy), sortOrder: query.sortOrder, estado: query.estado || '', desde: query.desde || '', hasta: query.hasta || '' }, responseType: 'blob' });
  }
  sortKey(key: string): string {
    const columns: Record<string, string> = { id: 'id_compra', fecha: 'fecha_compra', cliente: 'nombre_proveedor', folio: 'folio_factura', total: 'total' };
    return Object.hasOwn(columns, key) ? columns[key] : 'id_compra';
  }

  getDetalleCompra(id: number, fuente: 'compra' | 'orden' = 'compra'): Observable<DetalleCompraDb[]> {
    return this.http.get<DetalleCompraDb[]>(`${API_URL}/${id}/detalle`, { params: { fuente } });
  }
}
