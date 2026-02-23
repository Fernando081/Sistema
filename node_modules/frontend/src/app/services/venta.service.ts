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

  getFacturas(): Observable<FacturaResumen[]> {
    return this.http.get<FacturaResumen[]>(API_URL);
  }

  getDetalleFactura(idFactura: number): Observable<any[]> {
    return this.http.get<any[]>(`${API_URL}/${idFactura}/detalle`);
  }

  descargarPdf(idFactura: number): Observable<Blob> {
    return this.http.get(`${API_URL}/${idFactura}/pdf`, { responseType: 'blob' });
  }

  enviarCorreo(idFactura: number): Observable<any> {
    return this.http.post(`${API_URL}/${idFactura}/enviar-correo`, {});
  }
}