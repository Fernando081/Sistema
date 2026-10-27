import { CommonModule } from '@angular/common';
import { Component,DestroyRef,inject,signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute,Router,RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize,forkJoin,Observable } from 'rxjs';
import { ConfirmService } from '../shared/confirm.service';
import { AuthService } from '../auth/auth.service';
import { CrmSecuenciasService,SequenceControl,SequenceDetail,SequenceModel,SequenceRun,SequenceStep,SequenceTask } from './crm-secuencias.service';
@Component({selector:'app-crm-secuencias',standalone:true,imports:[CommonModule,FormsModule,RouterLink,MatButtonModule],templateUrl:'./crm-secuencias.component.html',styleUrl:'./campanas-locales-form.css'})
export class CrmSecuenciasComponent {
 private readonly api=inject(CrmSecuenciasService);private readonly destroy=inject(DestroyRef);private readonly confirm=inject(ConfirmService);private readonly auth=inject(AuthService);
 private readonly route=inject(ActivatedRoute);private readonly router=inject(Router);private selected='';
 readonly busy=signal(false);readonly error=signal('');readonly notice=signal('');readonly models=signal<SequenceModel[]>([]);readonly runs=signal<SequenceRun[]>([]);readonly detail=signal<SequenceDetail|null>(null);
 readonly controls=signal<SequenceControl[]>([]);readonly owners=signal<{id:number;nombre:string}[]>([]);isAdmin=false;controlReason='';controlPage=1;controlTotal=0;ownerPage=1;ownerTotal=0;ownerQ='';ownerId=0;
 readonly clients=signal<{id:number;nombre:string;rfc:string}[]>([]);userId=0;modelPage=1;modelTotal=0;modelQ='';page=1;total=0;q='';clientPage=1;clientTotal=0;clientQ='';clientId=0;modelId='';motivo='';reviewed=false;nombre='';
 steps:SequenceStep[]=[{titulo:'',descripcion:'',prioridad:'Media',horas:24}];private readonly intents=new Map<string,string>();
 constructor(){const id=this.route.snapshot.queryParamMap.get('secuencia')??'';if(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))this.selected=id;this.init();}
 private init(){this.request(forkJoin({models:this.api.models(1,''),runs:this.api.runs(1,''),profile:this.auth.getProfile()}),r=>{this.models.set(r.models.data);this.modelTotal=r.models.total;this.runs.set(r.runs.data);this.total=r.runs.total;this.userId=r.profile.idUser;this.isAdmin=r.profile.role==='admin';},()=>{if(this.selected)this.open(this.selected);});}
 refresh(){if(this.selected)this.open(this.selected);else if(!this.userId)this.init();else this.loadRuns();}
 private request<T>(source:Observable<T>,next:(r:T)=>void,after?:()=>void){if(this.busy())return;this.busy.set(true);this.error.set('');let ok=false;
  source.pipe(finalize(()=>{this.busy.set(false);if(ok&&!this.destroy.destroyed)after?.();}),takeUntilDestroyed(this.destroy)).subscribe({next:r=>{ok=true;next(r);},error:(e:unknown)=>{const b:unknown=e instanceof HttpErrorResponse?e.error:null,m=b&&typeof b==='object'&&'message'in b?b.message:null;this.error.set(Array.isArray(m)?m.join('. '):typeof m==='string'?m:'No se pudo completar la operación. Actualiza antes de reintentar.');}});
 }
 private intent(key:string){let id=this.intents.get(key);if(!id){id=crypto.randomUUID();this.intents.set(key,id);}return id;}
 loadModels(delta=0){if(this.busy())return;this.modelPage=delta?this.modelPage+delta:1;this.models.set([]);this.modelId='';this.reviewed=false;this.request(this.api.models(this.modelPage,this.modelQ.trim()),r=>{this.models.set(r.data);this.modelTotal=r.total;});}
 loadRuns(delta=0){if(this.busy())return;this.page=delta?this.page+delta:1;this.runs.set([]);this.request(this.api.runs(this.page,this.q.trim()),r=>{this.runs.set(r.data);this.total=r.total;});}
 loadClients(delta=0){if(this.busy())return;this.clientPage=delta?this.clientPage+delta:1;this.clients.set([]);this.clientId=0;this.reviewed=false;this.request(this.api.clients(this.clientPage,this.clientQ.trim()),r=>{this.clients.set(r.data);this.clientTotal=r.total;});}
 open(id:string){if(this.busy())return;this.selected=id;this.detail.set(null);this.controls.set([]);this.owners.set([]);this.ownerId=0;this.controlPage=1;void this.router.navigate([],{relativeTo:this.route,queryParams:{secuencia:id},replaceUrl:true});this.request(forkJoin({detail:this.api.detail(id),controls:this.api.controls(id,1)}),r=>{this.detail.set(r.detail);this.controls.set(r.controls.data);this.controlTotal=r.controls.total;});}
 back(){if(this.busy())return;this.selected='';this.detail.set(null);void this.router.navigate([],{relativeTo:this.route,queryParams:{},replaceUrl:true});this.loadRuns();}
 model(){return this.models().find(m=>m.id===this.modelId);}
 client(){return this.clients().find(c=>c.id===Number(this.clientId));}
 addStep(){if(this.steps.length<8)this.steps.push({titulo:'',descripcion:'',prioridad:'Media',horas:24});}
 validModel(){return !!this.nombre.trim()&&this.steps.every(s=>s.titulo.trim()&&Number.isInteger(s.horas)&&s.horas>=0&&s.horas<=720);}
 createModel(){if(this.busy()||!this.validModel())return;const nombre=this.nombre.trim(),pasos=this.steps.map(p=>({...p,titulo:p.titulo.trim(),descripcion:p.descripcion.trim()})),id=this.intent(JSON.stringify({nombre,pasos}));
  this.request(this.api.createModel(id,nombre,pasos),()=>{this.notice.set('Modelo guardado. Su contenido se conserva para las ejecuciones.');this.nombre='';this.steps=[{titulo:'',descripcion:'',prioridad:'Media',horas:24}];},()=>this.loadModels());
 }
 start(){const m=this.model(),c=this.client();if(this.busy()||!m||!c||!this.reviewed||!this.motivo.trim()||!this.userId)return;
  const motivo=this.motivo.trim(),id=this.intent(JSON.stringify({m:m.id,c:c.id,motivo}));
  this.confirm.ask({title:'Iniciar secuencia interna',message:`${m.nombre} para ${c.nombre}: ${m.pasos.length} pasos asignados a tu usuario. Se creará la primera tarea; las siguientes se crearán al completar el paso anterior.`,confirmLabel:'Iniciar secuencia'}).pipe(takeUntilDestroyed(this.destroy)).subscribe(ok=>{if(ok)this.request(this.api.start(id,m.id,c.id,this.userId,motivo),()=>{this.intents.delete(JSON.stringify({m:m.id,c:c.id,motivo}));this.notice.set('Secuencia iniciada.');this.reviewed=false;},()=>this.open(id));});
 }
 transition(t:SequenceTask,estado:string){const d=this.detail();if(!d||this.busy())return;
  const label=estado==='Cancelada'?'Cancelar secuencia':'Completar paso';
  this.confirm.ask({title:label,message:estado==='Cancelada'?'Se cancelará el paso actual y se cerrará la secuencia. Se conserva su historial.':'El paso se marcará como completado y se creará el siguiente, si existe. Esta acción no registra una comunicación con el cliente.',confirmLabel:label}).pipe(takeUntilDestroyed(this.destroy)).subscribe(ok=>{if(ok)this.request(this.api.transition(d.id,t,estado),()=>this.notice.set(estado==='Cancelada'?'Secuencia cancelada.':'Paso completado.'),()=>this.open(d.id));});
 }
 loadControls(delta:number){const d=this.detail();if(!d||this.busy())return;this.controlPage+=delta;this.controls.set([]);this.request(this.api.controls(d.id,this.controlPage),r=>{this.controls.set(r.data);this.controlTotal=r.total;});}
 loadOwners(delta=0){if(this.busy())return;this.ownerPage=delta?this.ownerPage+delta:1;this.owners.set([]);this.ownerId=0;this.request(this.api.owners(this.ownerPage,this.ownerQ.trim()),r=>{this.owners.set(r.data);this.ownerTotal=r.total;});}
 control(accion:'Pausar'|'Reanudar'|'Reasignar'){
  const d=this.detail(),motivo=this.controlReason.trim(),owner=this.owners().find(o=>o.id===Number(this.ownerId));if(!d||this.busy()||!motivo||accion==='Reasignar'&&(!owner||owner.id===d.idResponsable))return;
  const target=accion==='Reasignar'?owner!.id:undefined,key=JSON.stringify({id:d.id,version:d.version,accion,motivo,target}),request=this.intent(key),title=accion+' secuencia';
  const message=accion==='Pausar'?'Se suspenderán el tiempo restante y los avisos del paso actual hasta reanudar.':accion==='Reanudar'?'El plazo continuará con el tiempo que quedaba al pausar. Si ya estaba vencido, seguirá vencido.':`La tarea pendiente y los siguientes pasos quedarán a cargo de ${owner!.nombre}. Los pasos cerrados conservarán su responsable.`;
  this.confirm.ask({title,message,confirmLabel:title}).pipe(takeUntilDestroyed(this.destroy)).subscribe(ok=>{if(ok)this.request(this.api.control(d.id,request,d.version,accion,motivo,target),()=>{this.intents.delete(key);this.controlReason='';this.notice.set(accion==='Pausar'?'Secuencia pausada.':accion==='Reanudar'?'Secuencia reanudada.':'Responsable actualizado.');},()=>this.open(d.id));});
 }
}
