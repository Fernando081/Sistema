// frontend/src/app/services/venta.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Venta, FacturaResumen } from '../venta/venta.interface';

// Ajusta tu URL si es necesario
const API_URL = 'https://glorious-space-goggles-9rxj6pr5w5p3xp9g-3000.app.github.dev/api/v1/venta';

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