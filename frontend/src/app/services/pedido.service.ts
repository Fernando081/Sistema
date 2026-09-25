import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../environments/environment';

export interface PedidoResumen { idPedido: number; folio: number; estado: string; total: number; createdAt: string; updatedAt: string; cliente: string; rfc: string; cantidadPendiente: number; }
export interface PedidoPartida { idDetalle: number; idProducto: number; codigo: string; descripcion: string; cantidad: number; valorUnitario: number; importe: number; importeIva: number; cantidadReservada: number; cantidadSurtida: number; picking?: Array<{ almacen: string; ubicacion: string; cantidad: number; estado: string }>; }
export interface PedidoDetalle extends PedidoResumen { idCliente: number; idUnidad?: number | null; notas?: string | null; subtotal: number; impuestos: number; partidas: PedidoPartida[]; }
export interface Backorder { idBackorder: number; idPedido: number; folio: number; cantidad: number; cantidadAsignada: number; prioridad: number; estado: string; createdAt: string; cliente: string; codigo: string; producto: string; }
export interface ReservaVencida { idReserva: number; idPedido: number; folio: number; idProducto: number; codigo: string; producto: string; cantidad: number; expiresAt: string; cliente: string; }
export interface Disponibilidad { existenciaFisica: number; reservada: number; disponible: number; }
export interface CreatePedido { requestId: string; idCliente: number; idUnidad?: number | null; notas?: string; partidas: Array<{ idProducto: number; cantidad: number; valorUnitario: number }>; }

@Injectable({ providedIn: 'root' })
export class PedidoService {
  private readonly api = `${environment.apiBaseUrl}/pedidos`;
  constructor(private readonly http: HttpClient) {}
  getAll(filters: { q?: string; estado?: string; page?: number; limit?: number }) {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '') params = params.set(key, value);
    return this.http.get<{ data: PedidoResumen[]; total: number; page: number; limit: number }>(this.api, { params });
  }
  getOne(id: number) { return this.http.get<PedidoDetalle>(`${this.api}/${id}`); }
  create(dto: CreatePedido) { return this.http.post<{ idPedido: number }>(this.api, dto); }
  createFromQuote(idCotizacion: number, dto: { requestId: string; idUnidad?: number | null; notas?: string }) {
    return this.http.post<{ idPedido: number }>(`${this.api}/desde-cotizacion/${idCotizacion}`, dto);
  }
  confirm(id: number) { return this.http.post<PedidoDetalle>(`${this.api}/${id}/confirmar`, {}); }
  fulfill(id: number, partidas: Array<{ idDetalle: number; cantidad: number }>) { return this.http.post<PedidoDetalle>(`${this.api}/${id}/surtir`, { partidas }); }
  deliver(id: number, recibidoPor = '') { return this.http.post<PedidoDetalle>(`${this.api}/${id}/entregar`, { recibidoPor }); }
  invoice(id: number) { return this.http.post<{ message: string; idFactura: number }>(`${this.api}/${id}/facturar`, { requestId: crypto.randomUUID() }); }
  cancel(id: number) { return this.http.post(`${this.api}/${id}/cancelar`, {}); }
  getBackorders() { return this.http.get<Backorder[]>(`${this.api}/backorders`); }
  getExpiredReservations() { return this.http.get<ReservaVencida[]>(`${this.api}/reservas/vencidas`); }
  releaseExpiredReservations() { return this.http.post<{ reservasLiberadas: number; pedidosAfectados: number }>(`${this.api}/reservas/vencidas/liberar`, {}); }
  availability(idProducto: number) { return this.http.get<Disponibilidad>(`${this.api}/disponibilidad/${idProducto}`); }
}
