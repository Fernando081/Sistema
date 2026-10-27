import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { LOCAL_ERROR_FEEDBACK } from '../shared/http-error-context';
export interface MobileOrder {id:number;folio:string;estado:string;version:number;}
export interface MobilePick {id:string;idProducto:number;idUbicacion:number;codigo:string;producto:string;almacen:string;ubicacion:string;cantidad:string;verificada:string;pendiente:string;estado:string;habilitada:boolean;revision:number;evaluacionSha256:string;}
export interface MobileDetail {pedido:MobileOrder;data:MobilePick[];total:number;page:number;idUsuario:number;administrador:boolean;}
export interface MobileEvent {id:string;idSurtido:string;codigo:string;ubicacion:string;accion:string;cantidad:string;idAnulada:string|null;metodo:string|null;motivo:string|null;actor:number;autor:string;creadaEn:string;anulada:boolean;}
export interface VerifyPicking {requestId:string;idSurtido:string;evaluacionSha256:string;producto:string;ubicacion:string;cantidad:string;metodo:string;confirmacion:true;}
@Injectable({providedIn:'root'})
export class AlmacenMovilService {
 private readonly http=inject(HttpClient);private readonly base=`${environment.apiBaseUrl}/almacen/movil`;
 private readonly context=new HttpContext().set(LOCAL_ERROR_FEEDBACK,true);
 list(page:number,q:string,estado:string){return this.http.get<{data:MobileOrder[];total:number}>(this.base+'/pedidos',{params:{page,q,estado},context:this.context});}
 detail(id:number,page:number){return this.http.get<MobileDetail>(`${this.base}/pedidos/${id}`,{params:{page},context:this.context});}
 history(id:number,page:number){return this.http.get<{data:MobileEvent[];total:number}>(`${this.base}/pedidos/${id}/historial`,{params:{page},context:this.context});}
 verify(id:number,dto:VerifyPicking){return this.http.post<{id:string}>(`${this.base}/pedidos/${id}/verificar`,dto,{context:this.context});}
 cancel(id:number,requestId:string,idVerificacion:string,motivo:string){return this.http.post<{id:string}>(`${this.base}/pedidos/${id}/anular`,{requestId,idVerificacion,motivo,confirmacion:true},{context:this.context});}
 label(kind:'producto'|'ubicacion',id:number){return this.http.get(`${this.base}/etiquetas/${kind}/${id}`,{responseType:'blob',context:this.context});}
}
