import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type FiscalType = 'facturas' | 'reps';
export interface FiscalConfiguration {
  environment: 'mock' | 'sandbox' | 'production';
  provider: string;
  ready: boolean;
  missing: string[];
  issuerConfigured: boolean;
  productionEnabled: boolean;
}
export interface FiscalDocument {
  fiscal: boolean;
  tipo: string;
  estado: 'Borrador' | 'Procesando' | 'Timbrado' | 'Cancelacion solicitada' | 'Cancelado' | 'Error';
  uuid: string | null;
  hasXml?: boolean;
  hasAcknowledgement?: boolean;
  ultimo_error?: string | null;
  fecha_timbrado?: string | null;
  fecha_cancelacion?: string | null;
}
export interface FiscalCancellation {
  motivo?: '01' | '02' | '03' | '04';
  folioSustitucion?: string;
}

@Injectable({ providedIn: 'root' })
export class FiscalService {
  private readonly base = `${environment.apiBaseUrl}/fiscal`;
  constructor(private readonly http: HttpClient) {}

  configuration(): Observable<FiscalConfiguration> {
    return this.http.get<FiscalConfiguration>(`${this.base}/configuracion`);
  }
  document(type: FiscalType, id: number): Observable<FiscalDocument> {
    return this.http.get<FiscalDocument>(`${this.base}/${type}/${id}`);
  }
  stamp(type: FiscalType, id: number): Observable<FiscalDocument> {
    return this.http.post<FiscalDocument>(`${this.base}/${type}/${id}/timbrar`, {});
  }
  xml(type: FiscalType, id: number): Observable<Blob> {
    return this.http.get(`${this.base}/${type}/${id}/xml`, { responseType: 'blob' });
  }
  acknowledgement(type: FiscalType, id: number): Observable<Blob> {
    return this.http.get(`${this.base}/${type}/${id}/acuse`, { responseType: 'blob' });
  }
}
