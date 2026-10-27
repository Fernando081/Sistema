import { Injectable } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { LOCAL_ERROR_FEEDBACK } from '../shared/http-error-context';
import { environment } from '../../environments/environment';
export interface QuoteSnapshot {idCotizacion:number;idCliente:number;idUnidad:number|null;folio:number;nombre:string;rfc:string;fecha:string;vencimiento:string;subtotal:string;impuestos:string;retenciones:string;total:string;conceptos:{idConcepto:number;idProducto:number;descripcion:string;unidad:string;cantidad:string;precio:string;importe:string;iva:string;retencion:string}[]}
export interface QuoteReceipt {decision:string;nombre:string;comentario:string;fecha:string}
export interface QuoteVersionState {gestion:boolean;actual:{idRevision:number;idCotizacion:number;numero:number;respuesta:QuoteReceipt|null}|null;seleccion:number|null;revisionTotal:number;revisiones:{idRevision:number;idCotizacion:number;numero:number;motivo:string;autor:string;creadaEn:string;decision:string|null;nombreDeclarado:string|null;comentario:string|null;respondidaEn:string|null}[];invitaciones:{idInvitacion:number;venceEn:string;revocada:boolean;motivo:string|null;autor:string}[];snapshot:QuoteSnapshot;coincide?:boolean;productos:{idProducto:number;objetoImpuesto:string;tasaIva:number;aplicaRetencionIsr:boolean}[]}
export interface PublicQuote {numero:number;snapshot:Omit<QuoteSnapshot,'rfc'|'idCliente'|'idUnidad'|'conceptos'>&{conceptos:Omit<QuoteSnapshot['conceptos'][number],'idProducto'>[]};respuesta:QuoteReceipt|null}
@Injectable({providedIn:'root'})
export class CotizacionVersionService{
 constructor(private readonly http:HttpClient){}
 private options(){return{context:new HttpContext().set(LOCAL_ERROR_FEEDBACK,true)};}
 private base(id:number){return`${environment.apiBaseUrl}/cotizacion/${id}/versiones`;}
 state(id:number,page=1){return this.http.get<QuoteVersionState>(this.base(id),{...this.options(),params:{page}});}
 seal(id:number,body:unknown){return this.http.post(this.base(id)+'/sellar',body,this.options());}
 revise(id:number,body:unknown){return this.http.post<{idCotizacion:number}>(this.base(id),body,this.options());}
 invite(id:number,requestId:string){return this.http.post<{idInvitacion:number;token:string;venceEn:string}>(this.base(id)+'/enlaces',{requestId},this.options());}
 revoke(id:number,link:number,motivo:string){return this.http.post(`${this.base(id)}/enlaces/${link}/revocar`,{motivo},this.options());}
 consult(token:string){return this.http.post<PublicQuote>(`${environment.apiBaseUrl}/cotizacion-respuesta/consultar`,{token},{...this.options(),headers:{'X-Cotizacion-Respuesta':'1'}});}
 respond(body:unknown){return this.http.post<{respuesta:QuoteReceipt}>(`${environment.apiBaseUrl}/cotizacion-respuesta`,body,{...this.options(),headers:{'X-Cotizacion-Respuesta':'1'}});}
}
