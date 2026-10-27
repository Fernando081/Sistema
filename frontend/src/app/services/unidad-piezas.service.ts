import { Injectable } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { LOCAL_ERROR_FEEDBACK } from '../shared/http-error-context';
export interface PiezasPagina<T> { data: T[]; total: number; page: number; limit: number }
export interface PiezaOrigen { idConcepto: number; idFactura: number; factura: string; fechaEmision: string; codigo: string; descripcion: string; cantidad: string; disponible: string; aplicacionesTotal: number; aplicaciones: {fabricante_equipo: string | null; modelo: string | null; motor: string | null; anio_desde: number | null; anio_hasta: number | null; restricciones: string | null}[] }
export interface PiezaGarantia { idVinculo: number; idGarantia: number; estado: string; cantidad: string; motivo: string; autor: string; retirado: boolean; motivoRetiro: string | null }
export type CompatibilidadPieza = 'Pendiente' | 'Verificada' | 'Incompatible';
export interface PiezaUnidad { idPieza: number; idConcepto: number; idFactura: number; cantidad: string; fecha: string; detalle: string; codigo: string; descripcion: string; vin: string | null; esn: string | null; compatibilidad: CompatibilidadPieza; referencia: string; version: number; autor: string; revisadoPor: string; revisionEn: string; anulada: boolean; motivoAnulacion: string | null; factura: string; estadoFactura: string; unidadFactura: number | null; clienteFactura: number; conDevoluciones: boolean; garantiasTotal: number; garantias: PiezaGarantia[] }
export interface GarantiaCandidata { idGarantia: number; estado: string; motivo: string; cantidad: string }
@Injectable({providedIn: 'root'})
export class UnidadPiezasService {
 constructor(private readonly http: HttpClient) {}
 private base(id: number) { return `${environment.apiBaseUrl}/crm/unidades/${id}/piezas`; }
 private options() { return {context: new HttpContext().set(LOCAL_ERROR_FEEDBACK, true)}; }
 list(id: number, page: number, term: string) { return this.http.get<PiezasPagina<PiezaUnidad>>(this.base(id), {...this.options(), params: {page, term}}); }
 sources(id: number, page: number, term: string) { return this.http.get<PiezasPagina<PiezaOrigen>>(this.base(id) + '/origenes', {...this.options(), params: {page, term}}); }
 create(id: number, body: unknown) { return this.http.post(this.base(id), body, this.options()); }
 review(id: number, piece: number, body: unknown) { return this.http.post(`${this.base(id)}/${piece}/revision`, body, this.options()); }
 annul(id: number, piece: number, motivo: string) { return this.http.post(`${this.base(id)}/${piece}/anular`, {motivo}, this.options()); }
 claims(id: number, piece: number, page: number, term: string) { return this.http.get<PiezasPagina<GarantiaCandidata>>(`${this.base(id)}/${piece}/garantias-candidatas`, {...this.options(), params: {page, term}}); }
 history(id: number, piece: number, page: number) { return this.http.get<PiezasPagina<PiezaGarantia>>(`${this.base(id)}/${piece}/garantias-historial`, {...this.options(), params: {page}}); }
 link(id: number, piece: number, body: unknown) { return this.http.post(`${this.base(id)}/${piece}/garantias`, body, this.options()); }
 unlink(id: number, piece: number, link: number, motivo: string) { return this.http.post(`${this.base(id)}/${piece}/garantias/${link}/retirar`, {motivo}, this.options()); }
}
