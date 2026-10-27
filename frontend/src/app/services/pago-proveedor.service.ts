// frontend/src/app/services/pago-proveedor.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// La URL base se obtiene de environment.apiBaseUrl y se configura por entorno
const API_URL = `${environment.apiBaseUrl}/pago-proveedor`;

export interface PagoProveedorDto {
  idCompra: number;
  monto: number;
  formaPago: string;
  referencia?: string;
  notas?: string;
}

export interface LegacySupplierDebt {
  id_compra: number;
  id_proveedor: number;
  folio_factura_proveedor: string | null;
  fecha_compra: string;
  total: string | number;
  saldo_pendiente: string | number;
  proveedor_nombre: string;
}

export interface SupplierPaymentResult {
  message: string;
  idPago: number;
}

@Injectable({ providedIn: 'root' })
export class PagoProveedorService {
  constructor(private http: HttpClient) {}

  registrar(dto: PagoProveedorDto): Observable<SupplierPaymentResult> {
    return this.http.post<SupplierPaymentResult>(API_URL, dto);
  }

  getDeuda(idProveedor: number): Observable<LegacySupplierDebt[]> {
    return this.http.get<LegacySupplierDebt[]>(`${API_URL}/deuda/${idProveedor}`);
  }

  getAllDeuda(): Observable<LegacySupplierDebt[]> {
    return this.http.get<LegacySupplierDebt[]>(`${API_URL}/deuda`);
  }
}
