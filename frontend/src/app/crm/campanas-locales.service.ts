import { Injectable,inject } from '@angular/core';
import { HttpClient,HttpContext } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { LOCAL_ERROR_FEEDBACK } from '../shared/http-error-context';
export type CommercialChannel='Correo'|'WhatsApp'|'Llamada';
export interface CommercialPage<T>{data:T[];total:number;page:number;limit:number;}
export interface ConsentContact {id:number;nombre:string;canal:CommercialChannel;destino:string;destinoHuella:string|null;version:number;estado:string;venceEn:string|null;}
export interface ConsentRecord {id:number;idContacto:number;contacto:string;canal:string;estado:string;version:number;ocurridaEn:string;venceEn:string|null;fuente:string;referencia:string;motivo:string;creadaEn:string;autor:string;}
export interface ConsentInput {requestId:string;canal:CommercialChannel;estado:'Autorizado'|'Baja';versionAnterior:number;destinoHuella:string;ocurridaEn:string;venceEn?:string;fuente:string;referencia:string;motivo:string;confirmacion:boolean;}
export interface CampaignRow {id:number;nombre:string;estado:string;canal:string|null;segmento:string|null;}
export interface CampaignRecipient {idCliente:number;idContacto:number;cliente:string;contacto:string;destino:string;motivo:string;consentimiento:number|null;version:number;}
export interface CampaignPreparation {id:number;creadaEn:string;motivo:string;autor:string;sha256:string;evaluacionSha256:string;actual:boolean;}
export interface CampaignPreview extends CommercialPage<CampaignRecipient>{
 campana:CampaignRow&{plantilla:string|null;fechaInicio:string|null;fechaFin:string|null;asunto:string|null;contenido:string|null;};
 bloqueos:string[];metricas:{clientesSegmento:number;clientesSinContacto:number;contactosEvaluados:number;elegibles:number;excluidos:number;motivos:Record<string,number>};
 evaluacionSha256:string;evaluadaEn:string;ultima:CampaignPreparation|null;
}
/** O01.2c · Simulación de una campaña: revalida cada destinatario al procesarlo; no envía mensajes. */
export interface CampaignSimulation {id:number;idPreparacion:number;modo:'Simulacion';canal:string;estado:'En curso'|'Terminada'|'Cancelada';motivo:string;creadaEn:string;terminadaEn:string|null;motivoCierre:string|null;autor:string;
 total:number;pendientes:number;simulados:number;omitidos:number;cancelados:number;motivos:Record<string,number>;}
@Injectable({providedIn:'root'})
export class CampanasLocalesService {
 private readonly http=inject(HttpClient);private readonly api=environment.apiBaseUrl;
 private readonly local={context:new HttpContext().set(LOCAL_ERROR_FEEDBACK,true)};
 contacts(client:number,canal:CommercialChannel,page:number,q:string){return this.http.get<CommercialPage<ConsentContact>>(`${this.api}/clientes/${client}/consentimiento-comercial`,{...this.local,params:{canal,page,q}});}
 history(client:number,page:number){return this.http.get<CommercialPage<ConsentRecord>>(`${this.api}/clientes/${client}/consentimiento-comercial/historial`,{...this.local,params:{page}});}
 consent(client:number,contact:number,input:ConsentInput){return this.http.post<{id:number}>(`${this.api}/clientes/${client}/consentimiento-comercial/${contact}`,input,this.local);}
 campaigns(page:number,q:string){return this.http.get<CommercialPage<CampaignRow>>(`${this.api}/crm/campanas-locales`,{...this.local,params:{page,q}});}
 preview(id:number,page:number,q:string){return this.http.get<CampaignPreview>(`${this.api}/crm/campanas-locales/${id}/destinatarios`,{...this.local,params:{page,q}});}
 prepare(id:number,evaluacionSha256:string,requestId:string,motivo:string){return this.http.post<CampaignPreparation>(`${this.api}/crm/campanas-locales/${id}/preparar`,{evaluacionSha256,requestId,motivo,confirmacion:true},this.local);}
 simulations(id:number){return this.http.get<CampaignSimulation[]>(`${this.api}/crm/campanas-locales/${id}/ejecuciones`,this.local);}
 startSimulation(id:number,idPreparacion:number,requestId:string,motivo:string){return this.http.post<{id:number;repetida:boolean;destinatarios?:number}>(`${this.api}/crm/campanas-locales/${id}/ejecuciones`,{requestId,idPreparacion,motivo,confirmacion:true},this.local);}
 cancelSimulation(id:number,ejecucion:number,motivo:string){return this.http.post<{id:number;cancelados:number}>(`${this.api}/crm/campanas-locales/${id}/ejecuciones/${ejecucion}/cancelar`,{motivo,confirmacion:true},this.local);}
}
