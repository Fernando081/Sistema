import { Injectable,inject } from '@angular/core';
import { HttpClient,HttpContext } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { LOCAL_ERROR_FEEDBACK } from '../shared/http-error-context';
import { SequencePage,SequenceStep } from './crm-secuencias.service';
export interface SequenceRule {id:string;nombre:string;idModelo:string;modelo:string;etapa:string;eventoDesde:string;creadaEn:string;pasos:SequenceStep[];}
export interface RuleCandidate {id:string;idOportunidad:number;empresa:string;cliente:string|null;idCliente:number|null;responsable:string|null;estado:string;fecha:string;evaluacionSha256:string;tipoEvento:string;}
export interface RulePreview extends SequencePage<RuleCandidate>{regla:SequenceRule;metricas:{estado:string;total:number}[];}
export interface RuleApplication {id:string;idEvento:string;idSecuencia:string;motivo:string;fecha:string;actor:string;estado:string;cliente:string;}
@Injectable({providedIn:'root'})
export class CrmSecuenciaReglasService {
 private readonly http=inject(HttpClient);private readonly url=environment.apiBaseUrl+'/crm/reglas-secuencias';private readonly local={context:new HttpContext().set(LOCAL_ERROR_FEEDBACK,true)};
 list(page:number,q:string){return this.http.get<SequencePage<SequenceRule>>(this.url,{...this.local,params:{page,q}});}
 create(requestId:string,nombre:string,idModelo:string,etapa:string){return this.http.post<{id:string}>(this.url,{requestId,nombre,idModelo,etapa},this.local);}
 preview(id:string,page:number,q:string){return this.http.get<RulePreview>(this.url+'/'+id+'/eventos',{...this.local,params:{page,q}});}
 history(id:string,page:number){return this.http.get<SequencePage<RuleApplication>>(this.url+'/'+id+'/historial',{...this.local,params:{page}});}
 apply(id:string,event:RuleCandidate,requestId:string,motivo:string){return this.http.post<{id:string}>(this.url+'/'+id+'/aplicar',{requestId,idEvento:event.id,evaluacionSha256:event.evaluacionSha256,motivo,confirmacion:true},this.local);}
}
