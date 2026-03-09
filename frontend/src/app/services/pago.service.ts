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

export interface RepFacturaDto {
  idFactura: number;
  montoSaldado: number;
}

export interface RegistrarRepDto {
  idCliente: number;
  fechaPago: string;
  formaPago: string;
  moneda: string;
  montoTotal: number;
  cuentaBeneficiario?: string;
  rfcBeneficiario?: string;
  facturas: RepFacturaDto[];
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

  getAllPendientes(): Observable<any[]> {
    return this.http.get<any[]>(`${API_URL}/pendientes`);
  }

  getPpdPendientes(idCliente: number): Observable<any[]> {
    return this.http.get<any[]>(`${API_URL}/pendientes-ppd/${idCliente}`);
  }

  registrarRep(dto: RegistrarRepDto): Observable<any> {
    return this.http.post(`${API_URL}/rep`, dto);
  }

  descargarRepPdf(idPago: number): Observable<Blob> {
    return this.http.get(`${API_URL}/${idPago}/pdf`, { responseType: 'blob' });
  }

  descargarRepXml(idPago: number): Observable<Blob> {
    return this.http.get(`${API_URL}/${idPago}/xml`, { responseType: 'blob' });
  }

  getHistorialReps(): Observable<any[]> {
    return this.http.get<any[]>(`${API_URL}/rep`);
  }

  cancelarRep(idRep: number): Observable<any> {
    return this.http.post(`${API_URL}/rep/${idRep}/cancelar`, {});
  }
}