import { FacturaPendiente, RepHistorial, PagoRegistrado, RepRegistrado, RepCancelacion } from './pago-api.types';
// frontend/src/app/services/pago.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { FiscalCancellation } from './fiscal.service';

const API_URL = `${environment.apiBaseUrl}/pago`;

export interface PagoDto {
  requestId?: string;
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
  requestId?: string;
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

  registrar(dto: PagoDto): Observable<PagoRegistrado> {
    return this.http.post<PagoRegistrado>(API_URL, dto);
  }

  getPendientes(idCliente: number): Observable<FacturaPendiente[]> {
    return this.http.get<FacturaPendiente[]>(`${API_URL}/pendientes/${idCliente}`);
  }

  getAllPendientes(): Observable<FacturaPendiente[]> {
    return this.http.get<FacturaPendiente[]>(`${API_URL}/pendientes`);
  }

  getPpdPendientes(idCliente: number): Observable<FacturaPendiente[]> {
    return this.http.get<FacturaPendiente[]>(`${API_URL}/pendientes-ppd/${idCliente}`);
  }

  registrarRep(dto: RegistrarRepDto): Observable<RepRegistrado> {
    return this.http.post<RepRegistrado>(`${API_URL}/rep`, dto);
  }

  descargarRepPdf(idPago: number): Observable<Blob> {
    return this.http.get(`${API_URL}/${idPago}/pdf`, { responseType: 'blob' });
  }

  descargarRepXml(idPago: number): Observable<Blob> {
    return this.http.get(`${API_URL}/${idPago}/xml`, { responseType: 'blob' });
  }

  getHistorialReps(): Observable<RepHistorial[]> {
    return this.http.get<RepHistorial[]>(`${API_URL}/rep`);
  }

  cancelarRep(idRep: number, fiscal: FiscalCancellation = {}): Observable<RepCancelacion> {
    return this.http.post<RepCancelacion>(`${API_URL}/rep/${idRep}/cancelar`, fiscal);
  }
}
