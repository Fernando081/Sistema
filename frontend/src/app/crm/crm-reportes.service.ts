import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { LOCAL_ERROR_FEEDBACK } from '../shared/http-error-context';
export interface CommercialSchedule {
 id:string;nombre:string;frecuencia:'Diaria'|'Semanal';hora:number;minuto:number;dia:number|null;
 tipo:string;plazo:string;activa:boolean;version:number;zona:string;creadaEn:string;vigenteDesde:string;
}
export interface CommercialReport {
 id:string;programadaEn:string;generadaEn:string;estado:'Generado'|'Error';codigo:string|null;
 snapshot:{version:1;consultadoEn:string;zonaHoraria:string;tipo:string;plazo:string;total:number;
 resumen:{vencidas:number;hoy:number;proximas:number;sinFecha:number}}|null;
 reintento?:{estado:'Pendiente'|'EnCurso'|'Completado'|'Agotado'|'Cancelado';intentos:number;version:number;disponibleEn:string;
 eventos:{intento:number;fase:string;codigo:string|null;creadaEn:string}[]}|null;
 recuperacion?:{generadaEn:string;snapshot:NonNullable<CommercialReport['snapshot']>}|null;
}
export interface ScheduleCreate {nombre:string;frecuencia:'Diaria'|'Semanal';hora:number;minuto:number;dia?:number;tipo:string;plazo:string}
@Injectable({providedIn:'root'})
export class CrmReportesService {
 private readonly http=inject(HttpClient);private readonly base=`${environment.apiBaseUrl}/crm/reportes-programados`;
 private readonly context=new HttpContext().set(LOCAL_ERROR_FEEDBACK,true);
 list(page:number){return this.http.get<{data:CommercialSchedule[];total:number}>(this.base,{params:{page},context:this.context});}
 create(requestId:string,dto:ScheduleCreate){return this.http.post<{id:string}>(this.base,{requestId,...dto},{context:this.context});}
 control(p:CommercialSchedule){return this.http.patch(this.base+'/'+p.id,{activa:!p.activa,expectedVersion:p.version},{context:this.context});}
 history(id:string,page:number){return this.http.get<{programa:CommercialSchedule;data:CommercialReport[];total:number}>(this.base+'/'+id+'/historial',{params:{page},context:this.context});}
 retry(program:string,id:string){return this.http.post(`${this.base}/${program}/resultados/${id}/reintentar`,{confirmacion:true},{context:this.context});}
 cancelRetry(program:string,id:string,expectedVersion:number){return this.http.post(`${this.base}/${program}/resultados/${id}/cancelar-reintento`,{confirmacion:true,expectedVersion},{context:this.context});}
}
