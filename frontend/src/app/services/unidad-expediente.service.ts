import { Injectable } from '@angular/core';
import { HttpClient,HttpContext } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { LOCAL_ERROR_FEEDBACK } from '../shared/http-error-context';
export interface UnidadLectura {idLectura:number;fecha:string;kilometraje:string|null;horas:string|null;notas:string;autor:string;anulada:boolean;motivoAnulacion:string|null}
export interface UnidadMantenimiento {idMantenimiento:number;titulo:string;notas:string;fechaObjetivo:string|null;kilometrajeObjetivo:string|null;horasObjetivo:string|null;estado:'Pendiente'|'Realizado'|'Cancelado';condicion:string;version:number;fechaRealizada:string|null;detalleCierre:string|null;autor:string;cerradoPor:string|null}
export interface UnidadArchivo {idArchivo:number;titulo:string;nombre:string;tipo:'Foto'|'Documento';mime:string;bytes:number;sha256:string;autor:string;creadaEn:string;retirado:boolean;motivoRetiro:string|null}
export interface UnidadExpediente {unidad:{idUnidad:number;idCliente:number|null;idOportunidad:number|null;vin:string|null;esn:string|null;numeroEconomico:string|null;marca:string|null;modelo:string|null;anio:number|null;motor:string|null;notas:string|null;placas:string|null;transmision:string|null;diferencial:string|null};kilometrajeActual:string|null;horasActuales:string|null;permisos:{gestionar:boolean;anularRetirar:boolean};lecturas:{data:UnidadLectura[];total:number;page:number;limit:number};mantenimientos:{data:UnidadMantenimiento[];total:number;page:number;limit:number};archivos:UnidadArchivo[]}
@Injectable({providedIn:'root'})
export class UnidadExpedienteService{
 constructor(private readonly http:HttpClient){}
 private base(id:number){return`${environment.apiBaseUrl}/crm/unidades/${id}`;}
 private options(){return{context:new HttpContext().set(LOCAL_ERROR_FEEDBACK,true)};}
 get(id:number,lecturasPage:number,mantenimientosPage:number){return this.http.get<UnidadExpediente>(this.base(id)+'/expediente',{...this.options(),params:{lecturasPage,mantenimientosPage}});}
 lectura(id:number,body:unknown){return this.http.post(this.base(id)+'/lecturas',body,this.options());}
 anular(id:number,reading:number,motivo:string){return this.http.post(`${this.base(id)}/lecturas/${reading}/anular`,{motivo},this.options());}
 mantenimiento(id:number,body:unknown){return this.http.post(this.base(id)+'/mantenimientos',body,this.options());}
 cerrar(id:number,maintenance:number,body:unknown){return this.http.post(`${this.base(id)}/mantenimientos/${maintenance}/cerrar`,body,this.options());}
 subir(id:number,requestId:string,titulo:string,file:File){const form=new FormData();form.append('requestId',requestId);form.append('titulo',titulo);form.append('archivo',file);return this.http.post(this.base(id)+'/archivos',form,this.options());}
 archivo(id:number,file:number){return this.http.get(`${this.base(id)}/archivos/${file}`,{...this.options(),responseType:'blob'});}
 retirar(id:number,file:number,motivo:string){return this.http.post(`${this.base(id)}/archivos/${file}/retirar`,{motivo},this.options());}
}
