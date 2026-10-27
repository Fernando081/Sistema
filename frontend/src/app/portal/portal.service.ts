import { Injectable,inject } from '@angular/core';
import { HttpClient,HttpContext } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { LOCAL_ERROR_FEEDBACK } from '../shared/http-error-context';
export type PortalKind='pedidos'|'cotizaciones'|'facturas'|'unidades'|'garantias';
export interface PortalProfile {nombre:string;alias:string;cliente:string;venceEn:string;}
export interface PortalDocument {id:number;titulo:string;estado:string;fecha:string;total:string|null;moneda:string|null;detalle:Array<{etiqueta:string;valor:string}>;partidas:Array<{descripcion:string;cantidad:string;precio?:string;importe?:string}>;}
export interface PortalAccount {id:number;alias:string;nombre:string;estado:string;version:number;invitacionVenceEn:string|null;}
export interface PortalInvite {idAcceso:number;venceEn:string;token:string|null;}
export type PortalSourceKind='xml'|'acuse'|'cotizacion'|'entrega';
export interface PortalCandidate {tipo:PortalSourceKind;origen:number;titulo:string;clase:string;mime:string;origenSha256:string;}
export interface PortalPublication {id:number;titulo:string;clase:string;mime:string;bytes:number;sha256:string;creadaEn:string;retirada:boolean;disponible?:boolean;}
export function portalFileLabel(clase:string){return clase==='mock'?'PRUEBA MOCK · Sin validez fiscal':clase==='sandbox'?'PRUEBA PAC SANDBOX · Sin validez fiscal':clase==='production'?'Producción registrada · Sin consulta de vigencia SAT':'Copia documental · No es CFDI';}
@Injectable({providedIn:'root'})
export class PortalService {
 private readonly http=inject(HttpClient);private readonly api=environment.apiBaseUrl+'/portal';
 private readonly local={context:new HttpContext().set(LOCAL_ERROR_FEEDBACK,true)};
 state(){return this.http.get<PortalProfile>(this.api+'/sesion',this.local);}
 login(alias:string,password:string){return this.http.post(this.api+'/login',{alias,password},this.local);}
 activate(token:string,password:string){return this.http.post(this.api+'/activar',{token,password},this.local);}
 logout(){return this.http.post(this.api+'/salir',{},this.local);}
 password(actual:string,nueva:string){return this.http.post(this.api+'/password',{actual,nueva},this.local);}
 list(kind:PortalKind,page:number,q:string){return this.http.get<{data:PortalDocument[];total:number;page:number;limit:number}>(`${this.api}/documentos/${kind}`,{...this.local,params:{page,q}});}
 one(kind:PortalKind,id:number){return this.http.get<PortalDocument>(`${this.api}/documentos/${kind}/${id}`,this.local);}
 pdf(kind:PortalKind,id:number){return this.http.get(`${this.api}/documentos/${kind}/${id}/resumen`,{...this.local,responseType:'blob'});}
 files(page:number,q:string){return this.http.get<{data:PortalPublication[];total:number}>(this.api+'/archivos',{...this.local,params:{page,q}});}
 file(id:number){return this.http.get(`${this.api}/archivos/${id}/descarga`,{...this.local,responseType:'blob'});}
 publications(client:number,page:number){return this.http.get<{data:PortalPublication[];total:number}>(`${environment.apiBaseUrl}/clientes/${client}/portal-publicaciones`,{...this.local,params:{page}});}
 candidates(client:number,tipo:PortalSourceKind,page:number,q:string){return this.http.get<{data:PortalCandidate[];total:number}>(`${environment.apiBaseUrl}/clientes/${client}/portal-publicaciones/candidatos/${tipo}`,{...this.local,params:{page,q}});}
 preview(client:number,candidate:PortalCandidate){return this.http.post(`${environment.apiBaseUrl}/clientes/${client}/portal-publicaciones/vista-previa`,{tipo:candidate.tipo,origen:candidate.origen},{...this.local,responseType:'blob'});}
 publish(client:number,candidate:PortalCandidate,requestId:string,motivo:string){return this.http.post<PortalPublication>(`${environment.apiBaseUrl}/clientes/${client}/portal-publicaciones`,{tipo:candidate.tipo,origen:candidate.origen,origenSha256:candidate.origenSha256,requestId,motivo},this.local);}
 withdraw(client:number,id:number,requestId:string,motivo:string){return this.http.post<PortalPublication>(`${environment.apiBaseUrl}/clientes/${client}/portal-publicaciones/${id}/retirar`,{requestId,motivo},this.local);}
 accounts(client:number){return this.http.get<{cliente:string;data:PortalAccount[];total:number}>(`${environment.apiBaseUrl}/clientes/${client}/portal-accesos`,this.local);}
 invite(client:number,body:{requestId:string;alias:string;nombre:string;motivo:string}){return this.http.post<PortalInvite>(`${environment.apiBaseUrl}/clientes/${client}/portal-accesos`,body,this.local);}
 change(client:number,account:number,action:'restablecer'|'suspender',body:{requestId:string;version:number;motivo:string}){return this.http.post<PortalInvite|{message:string}>(`${environment.apiBaseUrl}/clientes/${client}/portal-accesos/${account}/${action}`,body,this.local);}
}
