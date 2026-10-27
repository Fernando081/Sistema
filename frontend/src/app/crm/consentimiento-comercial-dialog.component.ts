import { CommonModule } from '@angular/common';
import { Component,DestroyRef,inject,signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA,MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { finalize,Observable } from 'rxjs';
import { CampanasLocalesService,CommercialChannel,ConsentContact,ConsentInput,ConsentRecord } from './campanas-locales.service';
export function localConsentTime(){const date=new Date();return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,19);}
@Component({selector:'app-consentimiento-comercial-dialog',standalone:true,imports:[CommonModule,FormsModule,MatDialogModule,MatButtonModule],templateUrl:'./consentimiento-comercial-dialog.component.html',styleUrl:'./campanas-locales-form.css'})
export class ConsentimientoComercialDialogComponent {
 readonly client=inject<{idCliente:number;razonSocial:string}>(MAT_DIALOG_DATA);private readonly api=inject(CampanasLocalesService);private readonly destroy=inject(DestroyRef);
 readonly busy=signal(false);readonly error=signal('');readonly notice=signal('');readonly rows=signal<ConsentContact[]>([]);readonly history=signal<ConsentRecord[]>([]);readonly selected=signal<ConsentContact|null>(null);
 canal:CommercialChannel='Correo';q='';page=1;total=0;showHistory=false;estado:'Autorizado'|'Baja'='Autorizado';fuente='Documento';referencia='';motivo='';ocurrida=localConsentTime();vence='';confirmacion=false;private intents=new Map<string,string>();
 constructor(){this.load();}
 private request<T>(source:Observable<T>,next:(value:T)=>void,refresh=false){if(this.busy())return;this.busy.set(true);this.error.set('');let ok=false;
  source.pipe(finalize(()=>{this.busy.set(false);if(ok&&refresh&&!this.destroy.destroyed)this.load();}),takeUntilDestroyed(this.destroy)).subscribe({next:r=>{ok=true;next(r);},error:(e:unknown)=>{const body:unknown=e instanceof HttpErrorResponse?e.error:null;const message=body&&typeof body==='object'&&'message'in body?body.message:null;this.error.set(Array.isArray(message)?message.join('. '):typeof message==='string'?message:'No se pudo registrar o consultar. Actualiza antes de reintentar.');}});
 }
 load(){this.selected.set(null);this.rows.set([]);this.history.set([]);this.total=0;this.confirmacion=false;
  if(this.showHistory)this.request(this.api.history(this.client.idCliente,this.page),r=>{this.history.set(r.data);this.total=r.total;});
  else this.request(this.api.contacts(this.client.idCliente,this.canal,this.page,this.q),r=>{this.rows.set(r.data);this.total=r.total;});
 }
 search(){if(this.busy())return;this.page=1;this.load();}
 historyMode(value:boolean){if(this.busy())return;this.showHistory=value;this.page=1;this.load();}
 paginate(delta:number){if(this.busy())return;this.page+=delta;this.load();}
 select(c:ConsentContact){this.selected.set(c);this.confirmacion=false;this.ocurrida=localConsentTime();this.vence='';this.referencia='';this.motivo='';this.estado='Autorizado';}
 save(){const c=this.selected();if(this.busy()||!c?.destinoHuella||!this.confirmacion||!this.referencia.trim()||!this.motivo.trim()||!this.ocurrida)return;
  const occurred=new Date(this.ocurrida),expires=this.vence?new Date(this.vence):null;if(!Number.isFinite(occurred.getTime())||expires&&!Number.isFinite(expires.getTime())){this.error.set('Revisa las fechas.');return;}
  const fields={canal:this.canal,estado:this.estado,versionAnterior:c.version,destinoHuella:c.destinoHuella,ocurridaEn:occurred.toISOString(),...(this.estado==='Autorizado'&&expires?{venceEn:expires.toISOString()}:{}),fuente:this.fuente,referencia:this.referencia.trim(),motivo:this.motivo.trim(),confirmacion:true};
  const key=JSON.stringify({contact:c.id,...fields});let request=this.intents.get(key);if(!request){request=crypto.randomUUID();this.intents.set(key,request);}
  const input:ConsentInput={...fields,requestId:request};this.request(this.api.consent(this.client.idCliente,c.id,input),()=>{this.notice.set('Decisión registrada. No se enviaron mensajes. Revisa el estado actual del destino.');},true);
 }
}
