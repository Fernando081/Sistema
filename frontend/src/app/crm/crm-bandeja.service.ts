import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { LOCAL_ERROR_FEEDBACK } from '../shared/http-error-context';
export interface CommercialItem {
 id:string; tipo:'tarea'|'oportunidad'|'cotizacion'|'web'; titulo:string;
 cuenta:string|null; responsable:string|null; estado:string; fecha:string|null; plazo:string;
}
export interface CommercialInbox {
 data:CommercialItem[]; total:number; page:number; limit:number; administrador:boolean;
 consultadoEn:string; zonaHoraria:string;
 resumen:{vencidas:number; hoy:number; proximas:number; sinFecha:number};
}
export interface CommercialFilters {q:string; tipo:string; plazo:string}
@Injectable({providedIn:'root'})
export class CrmBandejaService {
 private readonly http=inject(HttpClient);
 list(page:number,filters:CommercialFilters){return this.http.get<CommercialInbox>(`${environment.apiBaseUrl}/crm/bandeja`,{
  params:{page,...filters},context:new HttpContext().set(LOCAL_ERROR_FEEDBACK,true),
 });}
}
