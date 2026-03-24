// frontend/src/app/services/venta.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Venta, FacturaResumen } from '../venta/venta.interface';

// La URL base se configura a través de environment.apiBaseUrl
const API_URL = `${environment.apiBaseUrl}/venta`;

@Injectable({
  providedIn: 'root'
})
export class VentaService {

  constructor(private http: HttpClient) { }

  crearVenta(venta: Venta): Observable<any> {
    return this.http.post(API_URL, venta);
  }

  getComisiones(): Observable<any[]> {
    return this.http.get<any[]>(`${API_URL}/comisiones`);
  }

  getFacturas(page: number = 1, limit: number = 10, term: string = ''): Observable<any> {
    const url = term ? `${API_URL}?page=${page}&limit=${limit}&term=${encodeURIComponent(term)}` : `${API_URL}?page=${page}&limit=${limit}`;
    return this.http.get<any>(url);
  }

  getDetalleFactura(idFactura: number): Observable<any[]> {
    return this.http.get<any[]>(`${API_URL}/${idFactura}/detalle`);
  }

  getDevoluciones(page: number = 1, limit: number = 10, term: string = ''): Observable<any> {
    const url = term ? `${API_URL}/devoluciones?page=${page}&limit=${limit}&term=${encodeURIComponent(term)}` : `${API_URL}/devoluciones?page=${page}&limit=${limit}`;
    return this.http.get<any>(url);
  }

  descargarPdf(idFactura: number): Observable<Blob> {
    return this.http.get(`${API_URL}/${idFactura}/pdf`, { responseType: 'blob' });
  }

  enviarCorreo(idFactura: number): Observable<any> {
    return this.http.post(`${API_URL}/${idFactura}/enviar-correo`, {});
  }

  descargarPdfDevolucion(idDevolucion: number): Observable<Blob> {
    return this.http.get(`${API_URL}/devolucion/${idDevolucion}/pdf`, { responseType: 'blob' });
  }

  cancelarFactura(idFactura: number): Observable<any> {
    return this.http.post(`${API_URL}/${idFactura}/cancelar`, {});
  }

  devolverParcial(idFactura: number, payload: any): Observable<any> {
    return this.http.post(`${API_URL}/${idFactura}/devolucion`, payload);
  }
}