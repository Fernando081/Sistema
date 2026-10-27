import { Component, DestroyRef, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, Observable } from 'rxjs';
import { ConfirmService } from '../shared/confirm.service';
import { CommercialReport, CommercialSchedule, CrmReportesService, ScheduleCreate } from './crm-reportes.service';
@Component({selector:'app-crm-reportes',standalone:true,imports:[CommonModule,FormsModule,RouterLink,MatButtonModule],templateUrl:'./crm-reportes.component.html',styleUrl:'./campanas-locales-form.css'})
export class CrmReportesComponent {
 private readonly api=inject(CrmReportesService);private readonly destroy=inject(DestroyRef);private readonly confirm=inject(ConfirmService);
 private readonly route=inject(ActivatedRoute);private readonly router=inject(Router);private readonly intents=new Map<string,string>();
 readonly busy=signal(false);readonly error=signal('');readonly notice=signal('');readonly schedules=signal<CommercialSchedule[]>([]);readonly detail=signal<CommercialSchedule|null>(null);readonly reports=signal<CommercialReport[]>([]);
 nombre='';frecuencia:'Diaria'|'Semanal'='Diaria';hora='09:00';dia=1;tipo='todos';plazo='todos';page=1;total=0;historyPage=1;historyTotal=0;
 readonly days=['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
 readonly sources:Record<string,string>={todos:'Todos los orígenes',tarea:'Tareas',oportunidad:'Oportunidades',cotizacion:'Cotizaciones',web:'Solicitudes web'};
 readonly deadlines:Record<string,string>={todos:'Todos los plazos',vencidas:'Vencidas',hoy:'Para hoy',proximas:'Próximos 7 días','sin-fecha':'Sin fecha'};
 private readonly format=new Intl.DateTimeFormat('es-MX',{timeZone:'America/Mexico_City',dateStyle:'short',timeStyle:'short'});
 date(value:string){return this.format.format(new Date(value));}
 constructor(){const id=this.route.snapshot.queryParamMap.get('programa');if(id&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))this.open(id);else this.load();}
 private request<T>(o:Observable<T>,next:(r:T)=>void,after?:()=>void){if(this.busy())return;this.busy.set(true);this.error.set('');let ok=false;
  o.pipe(finalize(()=>{this.busy.set(false);if(ok&&!this.destroy.destroyed)after?.();}),takeUntilDestroyed(this.destroy)).subscribe({next:r=>{next(r);ok=true;},error:(e:unknown)=>{
   const body:unknown=e instanceof HttpErrorResponse?e.error:null,msg=body&&typeof body==='object'&&'message'in body?body.message:null;
   this.error.set(typeof msg==='string'?msg:Array.isArray(msg)?msg.join('. '):'No se pudo completar la operación. Actualiza antes de reintentar.');
  }});
 }
 valid(){const match=/^(\d{2}):(\d{2})$/.exec(this.hora);return !!this.nombre.trim()&&this.nombre.trim().length<=120&&!!match&&Number(match[1])<24&&Number(match[2])%10===0&&Number(match[2])<60;}
 load(delta=0){if(this.busy())return;this.page+=delta;this.schedules.set([]);this.request(this.api.list(this.page),r=>{this.schedules.set(r.data);this.total=r.total;});}
 create(){if(!this.valid()||this.busy())return;const [hora,minuto]=this.hora.split(':').map(Number),dto:ScheduleCreate={nombre:this.nombre.trim(),frecuencia:this.frecuencia,hora,minuto,tipo:this.tipo,plazo:this.plazo,...(this.frecuencia==='Semanal'?{dia:Number(this.dia)}:{})},key=JSON.stringify(dto);let id=this.intents.get(key);if(!id){id=crypto.randomUUID();this.intents.set(key,id);}
  this.request(this.api.create(id,dto),()=>{this.intents.delete(key);this.notice.set('Programación guardada. Comienza desde el siguiente horario; no genera reportes retroactivos.');this.nombre='';},()=>{this.page=1;this.load();});
 }
 open(id:string,delta=0){if(this.busy())return;this.historyPage=delta?this.historyPage+delta:1;this.detail.set(null);this.reports.set([]);void this.router.navigate([],{relativeTo:this.route,queryParams:{programa:id},replaceUrl:true});
  this.request(this.api.history(id,this.historyPage),r=>{this.detail.set(r.programa);this.reports.set(r.data);this.historyTotal=r.total;});
 }
 back(){if(this.busy())return;this.detail.set(null);this.reports.set([]);void this.router.navigate([],{relativeTo:this.route,queryParams:{},replaceUrl:true});this.load();}
 toggle(p:CommercialSchedule){if(this.busy())return;this.confirm.ask({title:p.activa?'Suspender reportes':'Reanudar reportes',message:p.activa?'Se conservarán los reportes anteriores. No se generarán nuevos mientras esté suspendida.':'Se generarán desde el siguiente horario. Los periodos pasados no se completan.',confirmLabel:p.activa?'Suspender':'Reanudar'}).pipe(takeUntilDestroyed(this.destroy)).subscribe(ok=>{if(ok)this.request(this.api.control(p),()=>this.notice.set('Programación actualizada.'),()=>this.open(p.id));});}
 refresh(){const id=this.route.snapshot.queryParamMap.get('programa');if(id)this.open(id);else this.load();}
 retry(r:CommercialReport){const p=this.detail();if(!p||this.busy())return;this.confirm.ask({title:'Preparar reintento',message:'Se intentará recuperar este resumen en segundo plano, hasta tres veces. El error original se conserva y los datos corresponderán al nuevo corte, no al horario pasado.',confirmLabel:'Poner en cola'}).pipe(takeUntilDestroyed(this.destroy)).subscribe(ok=>{if(ok)this.request(this.api.retry(p.id,r.id),()=>this.notice.set('Reintento registrado. Consulta el estado en este historial.'),()=>this.open(p.id));});}
 cancelRetry(r:CommercialReport){const p=this.detail(),q=r.reintento;if(!p||!q||this.busy())return;this.confirm.ask({title:'Cancelar reintento',message:'Se conserva el error y los intentos anteriores. La cancelación es definitiva para este resultado; no suspende los siguientes reportes programados.',confirmLabel:'Cancelar reintento'}).pipe(takeUntilDestroyed(this.destroy)).subscribe(ok=>{if(ok)this.request(this.api.cancelRetry(p.id,r.id,q.version),()=>this.notice.set('Reintento cancelado.'),()=>this.open(p.id));});}
}
