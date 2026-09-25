import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
export interface SolicitudCompra {idSolicitud:number;folio:number;estado:string;motivo?:string;createdAt:string;solicitante?:string;partidas:number;estimado:number}
export interface OrdenCompra {idOrden:number;folio:number;estado:string;total:number;fechaPromesa?:string;createdAt:string;proveedor:string;partidas:number;pendiente:number}
export interface OrdenCompraDetalle extends Omit<OrdenCompra,'partidas'> {notas?:string;partidas:Array<{idDetalle:number;idProducto:number;codigo:string;descripcion:string;cantidad:number;cantidadRecibida:number;costoUnitario:number}>}
export interface ComparativoProveedor {idCotizacion:number;idProveedor:number;proveedor:string;marca?:string;precio:number;diasEntrega:number;fechaRegistro:string}
export interface EvaluacionProveedor {idProveedor:number;proveedor:string;evaluaciones:number;precio?:number;entrega?:number;calidad?:number;atencion?:number;promedio?:number}
export interface RecepcionCompra {idRecepcion:number;idOrden:number;folio:number;proveedor:string;referencia?:string;createdAt:string;partidas:number;total:number}
export interface RecepcionCompraDetalle extends Omit<RecepcionCompra,'partidas'|'total'> {notas?:string;partidas:Array<{idDetalle:number;idProducto:number;codigo:string;descripcion:string;cantidad:number;costoUnitario:number;cantidadDisponible:number}>}
@Injectable({providedIn:'root'})
export class AbastecimientoService{
 private readonly api=`${environment.apiBaseUrl}/abastecimiento`;
 constructor(private readonly http:HttpClient){}
 solicitudes(){return this.http.get<SolicitudCompra[]>(`${this.api}/solicitudes`)}
 crearSolicitud(dto:unknown){return this.http.post<{idSolicitud:number}>(`${this.api}/solicitudes`,dto)}
 autorizar(id:number){return this.http.post(`${this.api}/solicitudes/${id}/autorizar`,{})}
 ordenes(){return this.http.get<OrdenCompra[]>(`${this.api}/ordenes`)}
 orden(id:number){return this.http.get<OrdenCompraDetalle>(`${this.api}/ordenes/${id}`)}
 crearOrden(dto:unknown){return this.http.post<{idOrden:number}>(`${this.api}/ordenes`,dto)}
 recibir(id:number,dto:unknown){return this.http.post(`${this.api}/ordenes/${id}/recepciones`,dto)}
 recepciones(){return this.http.get<RecepcionCompra[]>(`${this.api}/recepciones`)}
 recepcion(id:number){return this.http.get<RecepcionCompraDetalle>(`${this.api}/recepciones/${id}`)}
 agregarCosto(id:number,dto:unknown){return this.http.post(`${this.api}/recepciones/${id}/costos`,dto)}
 devolverProveedor(dto:unknown){return this.http.post(`${this.api}/devoluciones-proveedor`,dto)}
 comparativo(idProducto:number){return this.http.get<ComparativoProveedor[]>(`${this.api}/comparativo/${idProducto}`)}
 evaluaciones(){return this.http.get<EvaluacionProveedor[]>(`${this.api}/evaluaciones`)}
 evaluar(dto:unknown){return this.http.post(`${this.api}/evaluaciones`,dto)}
}
