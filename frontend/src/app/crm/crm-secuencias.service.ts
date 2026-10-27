import { Injectable,inject } from '@angular/core';
import { HttpClient,HttpContext } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { LOCAL_ERROR_FEEDBACK } from '../shared/http-error-context';
export interface SequenceStep {titulo:string;descripcion:string;prioridad:string;horas:number;}
export interface SequenceModel {id:string;nombre:string;pasos:SequenceStep[];}
export interface SequenceRun {id:string;nombre:string;cliente:string;idCliente:number;idResponsable:number;responsable:string;estado:string;pasoActual:number;totalPasos:number;creadaEn:string;motivo:string;version:number;pausadaEn:string|null;}
export interface SequenceControl {id:string;accion:string;motivo:string;version:number;fecha:string;actor:string;anterior:string;nuevo:string;venceAntes:string;venceDespues:string;}
export interface SequenceTask {id:string;estado:string;version:number;venceEn:string;}
export interface SequenceDetail extends SequenceRun {pasos:(SequenceStep&{numero:number;tarea:SequenceTask|null})[];eventos:{id:string;evento:string;paso:number;fecha:string;actor:string}[];origen?:{idRegla:string;regla:string;empresa:string;etapa:string}|null;}
export interface SequencePage<T>{data:T[];total:number;page:number;}
@Injectable({providedIn:'root'})
export class CrmSecuenciasService {
 private readonly http=inject(HttpClient);private readonly url=environment.apiBaseUrl+'/crm/secuencias';
 private readonly local={context:new HttpContext().set(LOCAL_ERROR_FEEDBACK,true)};
 models(page:number,q:string){return this.http.get<SequencePage<SequenceModel>>(this.url+'/modelos',{...this.local,params:{page,q}});}
 createModel(requestId:string,nombre:string,pasos:SequenceStep[]){return this.http.post<{id:string}>(this.url+'/modelos',{requestId,nombre,pasos},this.local);}
 clients(page:number,q:string){return this.http.get<SequencePage<{id:number;nombre:string;rfc:string}>>(this.url+'/clientes',{...this.local,params:{page,q}});}
 runs(page:number,q:string){return this.http.get<SequencePage<SequenceRun>>(this.url,{...this.local,params:{page,q}});}
 detail(id:string){return this.http.get<SequenceDetail>(this.url+'/'+id,this.local);}
 start(requestId:string,idModelo:string,idCliente:number,idResponsable:number,motivo:string){return this.http.post<{id:string}>(this.url,{requestId,idModelo,idCliente,idResponsable,motivo,confirmacion:true},this.local);}
 transition(id:string,t:SequenceTask,estado:string){return this.http.patch(this.url+'/'+id+'/tarea',{idTarea:t.id,expectedVersion:t.version,estado},this.local);}
 owners(page:number,q:string){return this.http.get<SequencePage<{id:number;nombre:string}>>(this.url+'/responsables',{...this.local,params:{page,q}});}
 controls(id:string,page:number){return this.http.get<SequencePage<SequenceControl>>(this.url+'/'+id+'/controles',{...this.local,params:{page}});}
 control(id:string,requestId:string,expectedVersion:number,accion:string,motivo:string,idResponsable?:number){return this.http.post(this.url+'/'+id+'/controles',{requestId,expectedVersion,accion,motivo,confirmacion:true,...(idResponsable?{idResponsable}:{})},this.local);}
}
