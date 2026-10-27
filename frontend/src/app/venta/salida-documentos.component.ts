import { Component, DestroyRef, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, Observable } from 'rxjs';
import { ConfirmService } from '../shared/confirm.service';
import { Salida, SalidaDocumentosService, SalidaPreview } from './salida-documentos.service';
@Component({selector:'app-salida-documentos',standalone:true,imports:[CommonModule,FormsModule,RouterLink,MatButtonModule],templateUrl:'./salida-documentos.component.html',styleUrl:'../crm/campanas-locales-form.css'})
export class SalidaDocumentosComponent {
 private readonly api=inject(SalidaDocumentosService);private readonly destroy=inject(DestroyRef);private readonly confirm=inject(ConfirmService);private readonly intents=new Map<string,string>();
 readonly preview=signal<SalidaPreview|null>(null);readonly data=signal<Salida[]>([]);readonly busy=signal(false);readonly error=signal('');readonly notice=signal('');
 readonly id=Number(inject(ActivatedRoute).snapshot.queryParamMap.get('factura'));page=1;total=0;motivo='';
 readonly validId=Number.isInteger(this.id)&&this.id>0&&this.id<=2147483647;
 private readonly format=new Intl.DateTimeFormat('es-MX',{timeZone:'America/Mexico_City',dateStyle:'short',timeStyle:'short'});
 date(v:string){return this.format.format(new Date(v));}
 constructor(){if(this.validId)this.load();else this.error.set('Abre una factura desde Ventas → Facturas → Preparar correo local.');}
 private request<T>(source:Observable<T>,next:(v:T)=>void,after?:()=>void){if(this.busy())return;this.busy.set(true);this.error.set('');let ok=false;
  source.pipe(finalize(()=>{this.busy.set(false);if(ok&&!this.destroy.destroyed)after?.();}),takeUntilDestroyed(this.destroy)).subscribe({next:v=>{next(v);ok=true;},error:(e:unknown)=>{const body:unknown=e instanceof HttpErrorResponse?e.error:null,msg=body&&typeof body==='object'&&'message'in body?body.message:null;this.error.set(typeof msg==='string'?msg:'No se pudo completar. Consulta el historial antes de repetir una operación incierta.');}});
 }
 private key(k:string){let id=this.intents.get(k);if(!id){id=crypto.randomUUID();this.intents.set(k,id);}return id;}
 load(delta=0){if(this.busy()||!this.validId)return;this.page=delta?this.page+delta:1;this.request(this.api.list(this.id,this.page),r=>{this.data.set(r.data);this.total=r.total;});}
 review(){if(this.validId)this.request(this.api.preview(this.id),r=>this.preview.set(r));}
 prepare(){const p=this.preview();if(!p||this.busy())return;const k=JSON.stringify({factura:this.id,preview:p.evaluacionSha256});
  this.confirm.ask({title:'Preparar solicitud local',message:`Destinatario registrado: ${p.destinatario}. Se conservará una copia privada del PDF y del correo para simular su procesamiento. No se enviará ningún mensaje.`,confirmLabel:'Preparar solicitud'}).pipe(takeUntilDestroyed(this.destroy)).subscribe(ok=>{if(ok)this.request(this.api.prepare(this.id,this.key(k),p.evaluacionSha256),()=>{this.intents.delete(k);this.preview.set(null);this.notice.set('Solicitud preparada localmente. No se ha enviado ningún correo.');},()=>this.load());});
 }
 close(item:Salida,cancel=false){if(this.busy()||item.estado!=='Preparado'||(cancel&&!this.motivo.trim()))return;const reason=cancel?this.motivo.trim():undefined,k=JSON.stringify({id:item.id,cancel,reason});
  this.confirm.ask({title:cancel?'Cancelar solicitud':'Simular procesamiento',message:cancel?'La solicitud y el motivo se conservarán.':'Se revisarán destinatario, documento y sus huellas. El resultado Simulado no significa correo enviado o entregado.',confirmLabel:cancel?'Cancelar solicitud':'Simular localmente'}).pipe(takeUntilDestroyed(this.destroy)).subscribe(ok=>{if(ok)this.request(this.api.close(this.id,item.id,this.key(k),reason),r=>{this.intents.delete(k);this.notice.set(r.estado==='Obsoleto'?'El documento o destinatario cambió; se conservó como Obsoleto. Revisa antes de preparar otra solicitud.':cancel?'Solicitud cancelada.':'Simulación completada. No se envió ningún correo.');this.motivo='';},()=>this.load());});
 }
 download(item:Salida){this.request(this.api.file(this.id,item.id),blob=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='documento-preparado.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});}
}
