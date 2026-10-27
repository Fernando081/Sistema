import { CommonModule } from '@angular/common';
import { Component,DestroyRef,inject,signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute,Router,RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize,forkJoin,Observable } from 'rxjs';
import { ConfirmService } from '../shared/confirm.service';
import { CrmSecuenciasService,SequenceModel } from './crm-secuencias.service';
import { CrmSecuenciaReglasService,RuleApplication,RuleCandidate,RulePreview,SequenceRule } from './crm-secuencia-reglas.service';
@Component({selector:'app-crm-secuencia-reglas',standalone:true,imports:[CommonModule,FormsModule,RouterLink,MatButtonModule],templateUrl:'./crm-secuencia-reglas.component.html',styleUrl:'./campanas-locales-form.css'})
export class CrmSecuenciaReglasComponent {
 private readonly api=inject(CrmSecuenciaReglasService);private readonly seq=inject(CrmSecuenciasService);private readonly destroy=inject(DestroyRef);private readonly confirm=inject(ConfirmService);private readonly route=inject(ActivatedRoute);private readonly router=inject(Router);
 readonly busy=signal(false);readonly error=signal('');readonly notice=signal('');readonly rules=signal<SequenceRule[]>([]);readonly models=signal<SequenceModel[]>([]);readonly preview=signal<RulePreview|null>(null);readonly history=signal<RuleApplication[]>([]);
 selectedEvent:RuleCandidate|null=null;private selected='';private readonly intents=new Map<string,string>();
 listPage=1;listTotal=0;listQ='';modelPage=1;modelTotal=0;modelQ='';modelId='';nombre='';etapa='Cotizando';page=1;q='';historyPage=1;historyTotal=0;motivo='';reviewed=false;
 constructor(){const id=this.route.snapshot.queryParamMap.get('regla')??'';if(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))this.selected=id;this.init();}
 private request<T>(source:Observable<T>,next:(r:T)=>void,after?:()=>void){if(this.busy())return;this.busy.set(true);this.error.set('');let ok=false;
  source.pipe(finalize(()=>{this.busy.set(false);if(ok&&!this.destroy.destroyed)after?.();}),takeUntilDestroyed(this.destroy)).subscribe({next:r=>{ok=true;next(r);},error:(e:unknown)=>{const b:unknown=e instanceof HttpErrorResponse?e.error:null,m=b&&typeof b==='object'&&'message'in b?b.message:null;this.error.set(Array.isArray(m)?m.join('. '):typeof m==='string'?m:'No se pudo completar la revisión. Actualiza antes de reintentar.');}});
 }
 private intent(key:string){let id=this.intents.get(key);if(!id){id=crypto.randomUUID();this.intents.set(key,id);}return id;}
 private init(){this.request(forkJoin({rules:this.api.list(this.listPage,this.listQ.trim()),models:this.seq.models(this.modelPage,this.modelQ.trim())}),r=>{this.rules.set(r.rules.data);this.listTotal=r.rules.total;this.models.set(r.models.data);this.modelTotal=r.models.total;},()=>{if(this.selected)this.open(this.selected);});}
 refresh(){if(this.selected)this.open(this.selected);else this.init();}
 load(delta=0){if(this.busy())return;this.listPage=delta?this.listPage+delta:1;this.rules.set([]);this.request(this.api.list(this.listPage,this.listQ.trim()),r=>{this.rules.set(r.data);this.listTotal=r.total;});}
 loadModels(delta=0){if(this.busy())return;this.modelPage=delta?this.modelPage+delta:1;this.models.set([]);this.modelId='';this.request(this.seq.models(this.modelPage,this.modelQ.trim()),r=>{this.models.set(r.data);this.modelTotal=r.total;});}
 selectedModel(){return this.models().find(m=>m.id===this.modelId);}
 create(){if(this.busy()||!this.nombre.trim()||!this.models().some(m=>m.id===this.modelId))return;const nombre=this.nombre.trim(),id=this.intent(JSON.stringify({nombre,modelo:this.modelId,etapa:this.etapa}));this.request(this.api.create(id,nombre,this.modelId,this.etapa),r=>{this.notice.set('Regla guardada. Se revisarán los eventos nuevos de esa etapa.');this.nombre='';},()=>this.open(id));}
 open(id:string){if(this.busy())return;this.selected=id;this.preview.set(null);this.history.set([]);this.selectedEvent=null;this.reviewed=false;this.page=1;this.q='';this.historyPage=1;void this.router.navigate([],{relativeTo:this.route,queryParams:{regla:id},replaceUrl:true});this.request(forkJoin({preview:this.api.preview(id,1,''),history:this.api.history(id,1)}),r=>{this.preview.set(r.preview);this.history.set(r.history.data);this.historyTotal=r.history.total;});}
 back(){if(this.busy())return;this.selected='';this.preview.set(null);this.selectedEvent=null;void this.router.navigate([],{relativeTo:this.route,queryParams:{},replaceUrl:true});this.load();}
 loadEvents(delta=0){if(this.busy()||!this.selected)return;this.page=delta?this.page+delta:1;this.selectedEvent=null;this.reviewed=false;this.preview.set(null);this.request(this.api.preview(this.selected,this.page,this.q.trim()),r=>this.preview.set(r));}
 loadHistory(delta:number){if(this.busy()||!this.selected)return;this.historyPage+=delta;this.history.set([]);this.request(this.api.history(this.selected,this.historyPage),r=>{this.history.set(r.data);this.historyTotal=r.total;});}
 review(event:RuleCandidate){if(this.busy()||event.estado!=='Elegible')return;this.selectedEvent=event;this.reviewed=false;this.motivo='';}
 apply(){const e=this.selectedEvent,p=this.preview(),motivo=this.motivo.trim();if(!p||!e||!this.reviewed||!motivo||this.busy())return;
  const key=JSON.stringify({regla:p.regla.id,evento:e.id,hash:e.evaluacionSha256,motivo}),request=this.intent(key);
  this.confirm.ask({title:'Iniciar seguimiento por evento',message:`${e.empresa} · ${e.cliente} · ${e.responsable}. Se iniciará ${p.regla.modelo} usando este evento; el sistema volverá a comprobar el origen y los duplicados.`,confirmLabel:'Iniciar seguimiento'}).pipe(takeUntilDestroyed(this.destroy)).subscribe(ok=>{if(ok)this.request(this.api.apply(p.regla.id,e,request,motivo),()=>{this.intents.delete(key);this.notice.set('Seguimiento iniciado y origen conservado.');},()=>this.open(p.regla.id));});
 }
}
