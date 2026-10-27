import type { DirectoryQuery } from '../shared/remote-directory';
import { ComisionSemanas, VentaResultado, FacturaPagina, CancelacionVenta, TicketsGlobales } from './venta-api.types';
import { DetalleFacturaDb } from '../venta/venta.interface';
// frontend/src/app/services/venta.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Venta, FacturaResumen } from '../venta/venta.interface';
import { FiscalCancellation } from './fiscal.service';

// La URL base se configura a través de environment.apiBaseUrl
const API_URL = `${environment.apiBaseUrl}/venta`;

@Injectable({
  providedIn: 'root'
})
export class VentaService {

  constructor(private http: HttpClient) { }

  crearVenta(venta: Venta): Observable<VentaResultado> {
    return this.http.post<VentaResultado>(API_URL, venta);
  }

  getComisiones(): Observable<ComisionSemanas[]> {
    return this.http.get<ComisionSemanas[]>(`${API_URL}/comisiones`);
  }

  getFacturas(page = 1, limit = 10, term = '', tipo = '', sortBy = 'id', sortOrder = 'desc', estado = '', desde = '', hasta = ''): Observable<FacturaPagina> {
    return this.http.get<FacturaPagina>(API_URL, { params: { page, limit, term, tipo, sortBy, sortOrder, estado, desde, hasta } });
  }

  exportCsv(query: DirectoryQuery, tipo: string): Observable<Blob> {
    return this.http.get(`${API_URL}/exportar`, { params: { ...query, tipo }, responseType: 'blob' });
  }

  getDetalleFactura(idFactura: number): Observable<DetalleFacturaDb[]> {
    return this.http.get<DetalleFacturaDb[]>(`${API_URL}/${idFactura}/detalle`);
  }


  descargarPdf(idFactura: number): Observable<Blob> {
    return this.http.get(`${API_URL}/${idFactura}/pdf`, { responseType: 'blob' });
  }




  cancelarFactura(idFactura: number, fiscal: FiscalCancellation = {}): Observable<CancelacionVenta> {
    return this.http.post<CancelacionVenta>(`${API_URL}/${idFactura}/cancelar`, fiscal);
  }

  devolver(idFactura: number, dto: { metodoReembolso: 'Efectivo' | 'Saldo a Favor'; articulos: { idProducto: number; cantidad: number }[] }): Observable<unknown> {
    return this.http.post(`${API_URL}/${idFactura}/devoluciones`, dto);
  }


  getFacturasRelacionables(idCliente: number): Observable<FacturaResumen[]> {
    return this.http.get<FacturaResumen[]>(`${environment.apiBaseUrl}/factura/cliente/${idCliente}/relacionables`);
  }

  getTicketsPendientesGlobal(fechaInicio: string, fechaFin: string): Observable<TicketsGlobales> {
    return this.http.get<TicketsGlobales>(`${environment.apiBaseUrl}/factura/global/tickets-pendientes`, {
      params: { fechaInicio, fechaFin }
    });
  }

  generarFacturaGlobal(fechaInicio: string, fechaFin: string, idsTickets: number[]): Observable<VentaResultado> {
    return this.http.post<VentaResultado>(`${environment.apiBaseUrl}/factura/global/generar`, {
      fechaInicio,
      fechaFin,
      idsTickets
    });
  }
}
