import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { LOCAL_ERROR_FEEDBACK } from '../shared/http-error-context';
export interface SalidaPreview {idFactura:number;folio:string;destinatario:string;asunto:string;ambiente:string;evaluacionSha256:string;modo:'Local';}
export interface Salida {id:string;creadaEn:string;ambiente:string;bytes:number;pdfSha256:string;autor:string;estado:'Preparado'|'Simulado'|'Cancelado'|'Obsoleto';cerradaEn:string|null;motivo:string|null;destinatario:string;asunto:string;}
@Injectable({providedIn:'root'})
export class SalidaDocumentosService {
 private readonly http=inject(HttpClient);private readonly base=environment.apiBaseUrl+'/venta';private readonly context=new HttpContext().set(LOCAL_ERROR_FEEDBACK,true);
 preview(id:number){return this.http.get<SalidaPreview>(`${this.base}/${id}/preparar-correo`,{context:this.context});}
 list(id:number,page:number){return this.http.get<{data:Salida[];total:number;page:number}>(`${this.base}/${id}/correos`,{params:{page},context:this.context});}
 prepare(id:number,requestId:string,evaluacionSha256:string){return this.http.post<{id:string}>(`${this.base}/${id}/enviar-correo`,{requestId,evaluacionSha256,confirmacion:true},{context:this.context});}
 close(id:number,item:string,requestId:string,motivo?:string){return this.http.post<{estado:string;envioExterno:false}>(`${this.base}/${id}/correos/${item}/${motivo===undefined?'simular':'cancelar'}`,{requestId,confirmacion:true,...(motivo!==undefined?{motivo}:{})},{context:this.context});}
 file(id:number,item:string){return this.http.get(`${this.base}/${id}/correos/${item}/pdf`,{responseType:'blob',context:this.context});}
}
