import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { LOCAL_ERROR_FEEDBACK } from '../shared/http-error-context';
/** O01.2b · Estado público de la configuración de correo (sin secretos). */
export interface CorreoEstado {modo:'desactivado'|'smtp';habilitado:boolean;servidor:string|null;tls:string;autenticacion:boolean;remitente:string|null;dominiosPermitidos:string[];maxIntentos:number;problemas:string[];destinatarioPermitido:boolean;disponible:boolean;}
export interface SalidaPreview {idFactura:number;folio:string;destinatario:string;asunto:string;ambiente:string;evaluacionSha256:string;modo:'Local';correo:CorreoEstado;}
export type SalidaEstado='Preparado'|'Simulado'|'Cancelado'|'Obsoleto'|'En cola'|'Enviando'|'Reintento'|'Incierto'|'Aceptado'|'Fallido';
export interface Salida {id:string;creadaEn:string;ambiente:string;bytes:number;pdfSha256:string;autor:string;estado:SalidaEstado;cerradaEn:string|null;motivo:string|null;destinatario:string;asunto:string;
 modo:'Local'|'Correo';envioEstado:string|null;intentos:number|null;maxIntentos:number|null;proximoIntento:string|null;ultimoError:string|null;respuestaSmtp:string|null;}
export type Conciliacion='ConfirmarAceptado'|'Reintentar'|'DarPorFallido';
@Injectable({providedIn:'root'})
export class SalidaDocumentosService {
 private readonly http=inject(HttpClient);private readonly base=environment.apiBaseUrl+'/venta';private readonly context=new HttpContext().set(LOCAL_ERROR_FEEDBACK,true);
 preview(id:number){return this.http.get<SalidaPreview>(`${this.base}/${id}/preparar-correo`,{context:this.context});}
 list(id:number,page:number){return this.http.get<{data:Salida[];total:number;page:number;correo:CorreoEstado}>(`${this.base}/${id}/correos`,{params:{page},context:this.context});}
 prepare(id:number,requestId:string,evaluacionSha256:string,modo:'Local'|'Correo'='Local'){return this.http.post<{id:string;modo:'Local'|'Correo'}>(`${this.base}/${id}/enviar-correo`,{requestId,evaluacionSha256,confirmacion:true,...(modo==='Correo'?{modo}:{})},{context:this.context});}
 close(id:number,item:string,requestId:string,motivo?:string){return this.http.post<{estado:string;envioExterno:false}>(`${this.base}/${id}/correos/${item}/${motivo===undefined?'simular':'cancelar'}`,{requestId,confirmacion:true,...(motivo!==undefined?{motivo}:{})},{context:this.context});}
 conciliar(id:number,item:string,requestId:string,accion:Conciliacion,motivo:string){return this.http.post<{id:string;accion:Conciliacion}>(`${this.base}/${id}/correos/${item}/conciliar`,{requestId,confirmacion:true,accion,motivo},{context:this.context});}
 file(id:number,item:string){return this.http.get(`${this.base}/${id}/correos/${item}/pdf`,{responseType:'blob',context:this.context});}
}
