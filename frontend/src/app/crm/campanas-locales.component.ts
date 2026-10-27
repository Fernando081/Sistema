import { CommonModule } from '@angular/common';
import { Component,DestroyRef,inject,signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute,RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog,MatDialogModule } from '@angular/material/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize,Observable } from 'rxjs';
import { ConfirmService } from '../shared/confirm.service';
import { CampanasLocalesService,CampaignPreview,CampaignRow } from './campanas-locales.service';
@Component({selector:'app-campanas-locales',standalone:true,imports:[CommonModule,FormsModule,RouterLink,MatButtonModule,MatDialogModule],templateUrl:'./campanas-locales.component.html',styleUrl:'./campanas-locales-form.css'})
export class CampanasLocalesComponent {
 private readonly api=inject(CampanasLocalesService);private readonly destroy=inject(DestroyRef);private readonly confirm=inject(ConfirmService);private readonly dialog=inject(MatDialog);private readonly route=inject(ActivatedRoute);
 readonly busy=signal(false);readonly error=signal('');readonly notice=signal('');readonly campaigns=signal<CampaignRow[]>([]);readonly preview=signal<CampaignPreview|null>(null);
 listPage=1;listTotal=0;listQ='';page=1;q='';motivo='';reviewed=false;private selected=0;private intents=new Map<string,string>();
 constructor(){const initial=Number(this.route.snapshot.queryParamMap.get('campana'));if(Number.isSafeInteger(initial)&&initial>0&&initial<=2147483647){this.selected=initial;this.loadPreview();}else this.load();}
 private request<T>(source:Observable<T>,next:(value:T)=>void,after?:()=>void){if(this.busy())return;this.busy.set(true);this.error.set('');let ok=false;
  source.pipe(finalize(()=>{this.busy.set(false);if(ok&&!this.destroy.destroyed)after?.();}),takeUntilDestroyed(this.destroy)).subscribe({next:r=>{ok=true;next(r);},error:(e:unknown)=>{const body:unknown=e instanceof HttpErrorResponse?e.error:null;const message=body&&typeof body==='object'&&'message'in body?body.message:null;this.error.set(Array.isArray(message)?message.join('. '):typeof message==='string'?message:'No se pudo completar la revisión. Actualiza antes de reintentar.');}});
 }
 load(){this.campaigns.set([]);this.listTotal=0;this.request(this.api.campaigns(this.listPage,this.listQ.trim()),r=>{this.campaigns.set(r.data);this.listTotal=r.total;});}
 searchList(){if(this.busy())return;this.listPage=1;this.load();}
 paginateList(delta:number){if(this.busy())return;this.listPage+=delta;this.load();}
 open(id:number){if(this.busy())return;this.selected=id;this.page=1;this.q='';this.notice.set('');this.loadPreview();}
 loadPreview(){this.preview.set(null);this.reviewed=false;this.request(this.api.preview(this.selected,this.page,this.q.trim()),r=>this.preview.set(r));}
 search(){if(this.busy())return;this.page=1;this.loadPreview();}
 paginate(delta:number){if(this.busy())return;this.page+=delta;this.loadPreview();}
 back(){if(this.busy())return;this.selected=0;this.preview.set(null);this.load();}
 prepare(){const p=this.preview();if(this.busy()||!p||p.bloqueos.length||!p.metricas.elegibles||!this.reviewed||!this.motivo.trim())return;
  const motivo=this.motivo.trim(),key=JSON.stringify({id:p.campana.id,hash:p.evaluacionSha256,motivo});let request=this.intents.get(key);if(!request){request=crypto.randomUUID();this.intents.set(key,request);}const requestId=request;
  this.confirm.ask({title:'Conservar preparación local',message:`${p.campana.nombre}: ${p.metricas.elegibles} destinatarios elegibles y ${p.metricas.excluidos} contactos excluidos en ${p.campana.canal}. Se conservará la revisión; la campaña sigue en Borrador.`,confirmLabel:'Conservar preparación'}).pipe(takeUntilDestroyed(this.destroy)).subscribe(ok=>{if(ok)this.request(this.api.prepare(p.campana.id,p.evaluacionSha256,requestId,motivo),r=>this.notice.set(`Preparación ${r.id} conservada. No se enviaron mensajes.`),()=>this.loadPreview());});
 }
 async preferences(idCliente:number,razonSocial:string){if(this.busy())return;const {ConsentimientoComercialDialogComponent}=await import('./consentimiento-comercial-dialog.component');
  this.dialog.open(ConsentimientoComercialDialogComponent,{width:'820px',maxWidth:'96vw',disableClose:true,data:{idCliente,razonSocial}}).afterClosed().pipe(takeUntilDestroyed(this.destroy)).subscribe(()=>this.loadPreview());
 }
}
