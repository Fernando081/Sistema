import { CommonModule } from '@angular/common';
import { Component,DestroyRef,inject,signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA,MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { finalize,Observable } from 'rxjs';
import { ConfirmService } from '../shared/confirm.service';
import { downloadDocument } from '../shared/document-download';
import { PortalCandidate,PortalPublication,PortalService,PortalSourceKind,portalFileLabel } from './portal.service';
@Component({selector:'app-portal-publications-dialog',standalone:true,imports:[CommonModule,FormsModule,MatDialogModule,MatButtonModule],templateUrl:'./portal-publications-dialog.component.html',styles:[`
 :host{display:block;color:var(--c-text)}label{display:grid;gap:.4rem;margin:.8rem 0}input,select,textarea{box-sizing:border-box;width:100%;background:var(--c-canvas);color:inherit;font:inherit;padding:.65rem;border:1px solid var(--c-border);border-radius:6px}fieldset{border:1px solid var(--c-border);min-width:0}article{border-top:1px solid var(--c-border);padding:1rem 0;overflow-wrap:anywhere}.actions{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}button{min-height:44px;height:auto;white-space:normal}small{display:block;line-height:1.5}p{line-height:1.5}.notice{padding:.8rem;border:1px solid var(--c-border);border-radius:6px}
 `]})
export class PortalPublicationsDialogComponent {
 private readonly service=inject(PortalService);private readonly destroy=inject(DestroyRef);private readonly confirm=inject(ConfirmService);
 readonly client=inject<{idCliente:number;razonSocial:string}>(MAT_DIALOG_DATA);readonly busy=signal(false);readonly error=signal('');readonly notice=signal('');readonly candidates=signal<PortalCandidate[]>([]);readonly publications=signal<PortalPublication[]>([]);readonly reviewed=signal('');readonly label=portalFileLabel;
 mode:'candidatos'|'publicaciones'='candidatos';tipo:PortalSourceKind='xml';q='';motivo='';page=1;total=0;private intents=new Map<string,string>();
 constructor(){this.load();}
 private request<T>(source:Observable<T>,next:(value:T)=>void,refresh=false){if(this.busy())return;this.busy.set(true);this.error.set('');let ok=false;
  source.pipe(finalize(()=>{this.busy.set(false);if(ok&&refresh&&!this.destroy.destroyed)this.load();}),takeUntilDestroyed(this.destroy)).subscribe({next:r=>{ok=true;next(r);},error:(e:unknown)=>{
   const data:unknown=e instanceof HttpErrorResponse?e.error:null;const message=data&&typeof data==='object'&&'message'in data?data.message:null;this.error.set(Array.isArray(message)?message.join('. '):typeof message==='string'?message:'No se pudo completar la operación. Actualiza y revisa el origen antes de reintentar.');
  }});
 }
 private key(value:unknown){const hash=JSON.stringify(value);let id=this.intents.get(hash);if(!id){id=crypto.randomUUID();this.intents.set(hash,id);}return id;}
 load(){this.reviewed.set('');this.candidates.set([]);this.publications.set([]);this.total=0;
  if(this.mode==='candidatos')this.request(this.service.candidates(this.client.idCliente,this.tipo,this.page,this.q),r=>{this.candidates.set(r.data);this.total=r.total;});
  else this.request(this.service.publications(this.client.idCliente,this.page),r=>{this.publications.set(r.data);this.total=r.total;});
 }
 switch(mode:'candidatos'|'publicaciones'){if(this.busy())return;this.mode=mode;this.page=1;this.q='';this.load();}
 search(){if(this.busy())return;this.page=1;this.load();}
 paginate(delta:number){if(this.busy())return;this.page+=delta;this.load();}
 preview(c:PortalCandidate){this.reviewed.set('');this.request(this.service.preview(this.client.idCliente,c),blob=>{downloadDocument(blob,`revision-${c.clase}.${c.mime==='application/xml'?'xml':'pdf'}`);this.reviewed.set(c.origenSha256);});}
 publish(c:PortalCandidate){if(this.busy()||this.reviewed()!==c.origenSha256||!this.motivo.trim())return;
  const motivo=this.motivo.trim(),request=this.key({c,motivo,action:'publicar'});
  this.confirm.ask({title:'Publicar archivo para el cliente',message:`${this.client.razonSocial}: ${c.titulo}. ${this.label(c.clase)}. Todos los contactos activos de este cliente podrán descargarlo. Confirma que revisaste el archivo y autorizas compartirlo.`,confirmLabel:'Publicar archivo'}).pipe(takeUntilDestroyed(this.destroy)).subscribe(ok=>{if(ok)this.request(this.service.publish(this.client.idCliente,c,request,motivo),()=>{this.notice.set('Archivo publicado para este cliente.');this.mode='publicaciones';this.page=1;},true);});
 }
 withdraw(p:PortalPublication){if(this.busy()||!this.motivo.trim()){this.error.set('Escribe el motivo del retiro.');return;}const motivo=this.motivo.trim(),request=this.key({id:p.id,motivo,action:'retirar'});
  this.confirm.ask({title:'Retirar archivo del portal',message:`${p.titulo}: se bloquearán nuevas descargas. Las copias ya descargadas no se pueden recuperar. Se conserva el registro interno.`,confirmLabel:'Retirar archivo'}).pipe(takeUntilDestroyed(this.destroy)).subscribe(ok=>{if(ok)this.request(this.service.withdraw(this.client.idCliente,p.id,request,motivo),()=>this.notice.set('Archivo retirado; ya no admite nuevas descargas.'),true);});
 }
}
