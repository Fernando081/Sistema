import { CommonModule } from '@angular/common';
import { Component,DestroyRef,inject,signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA,MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { finalize,Observable } from 'rxjs';
import { ConfirmService } from '../shared/confirm.service';
import { PortalAccount,PortalInvite,PortalService } from './portal.service';
@Component({selector:'app-portal-access-dialog',standalone:true,imports:[CommonModule,FormsModule,MatDialogModule,MatButtonModule],templateUrl:'./portal-access-dialog.component.html',styles:[`
 :host{color:var(--wrap-text-title);display:block}label{display:grid;gap:.4rem;margin:.7rem 0}input,textarea{box-sizing:border-box;width:100%;padding:.6rem;border:1px solid var(--wrap-border);border-radius:6px;background:var(--wrap-bg);color:var(--wrap-text-title);font:inherit}fieldset{border:1px solid var(--wrap-border);min-width:0;border-radius:8px}article{padding:1rem 0;border-bottom:1px solid var(--wrap-border);overflow-wrap:anywhere}.actions{display:flex;gap:.4rem;flex-wrap:wrap}.message{padding:.8rem;border:1px solid var(--wrap-border);border-radius:6px}button{height:auto;min-height:40px;white-space:normal}
 `]})
export class PortalAccessDialogComponent {
 private readonly service=inject(PortalService);private readonly destroy=inject(DestroyRef);private readonly confirm=inject(ConfirmService);
 readonly client=inject<{idCliente:number;razonSocial:string}>(MAT_DIALOG_DATA);readonly rows=signal<PortalAccount[]>([]);readonly busy=signal(false);readonly error=signal('');readonly link=signal('');readonly expires=signal('');readonly invitedAlias=signal('');
 alias='';nombre='';motivo='';private intents=new Map<string,string>();
 constructor(){this.load();this.destroy.onDestroy(()=>this.link.set(''));}
 private failure(e:unknown){const body:unknown=e instanceof HttpErrorResponse?e.error:null;const message=body&&typeof body==='object'&&'message'in body?body.message:null;this.error.set(Array.isArray(message)?message.join('. '):typeof message==='string'?message:'No se pudo completar la operación. Consulta la lista antes de emitir otro enlace.');}
 private request<T>(request:Observable<T>,next:(value:T)=>void,refresh=false){if(this.busy())return;this.busy.set(true);this.error.set('');let ok=false;
  request.pipe(finalize(()=>{this.busy.set(false);if(ok&&refresh&&!this.destroy.destroyed)this.load();}),takeUntilDestroyed(this.destroy)).subscribe({next:r=>{ok=true;next(r);},error:e=>this.failure(e)});
 }
 load(){this.request(this.service.accounts(this.client.idCliente),r=>this.rows.set(r.data));}
 private key(fields:unknown){const key=JSON.stringify(fields);let id=this.intents.get(key);if(!id){id=crypto.randomUUID();this.intents.set(key,id);}return id;}
 private invitation(r:PortalInvite,alias:string){this.invitedAlias.set(alias);this.link.set(r.token?window.location.origin+'/portal/activar#token='+r.token:'');this.expires.set(r.venceEn);if(!r.token)this.error.set('La invitación ya no está disponible. Revisa el estado antes de restablecer.');}
 create(){if(this.busy()||!this.motivo.trim()||!this.nombre.trim())return;const fields={alias:this.alias.trim().toLowerCase(),nombre:this.nombre.trim(),motivo:this.motivo.trim()};
  this.link.set('');this.request(this.service.invite(this.client.idCliente,{...fields,requestId:this.key(fields)}),r=>{this.invitation(r,fields.alias);this.alias='';this.nombre='';},true);
 }
 change(account:PortalAccount,action:'restablecer'|'suspender'){
  if(this.busy())return;if(!this.motivo.trim()){this.error.set('Escribe el motivo del cambio.');return;}
  const fields={version:account.version,motivo:this.motivo.trim()},requestId=this.key({id:account.id,action,...fields});
  this.confirm.ask({title:action==='restablecer'?'Restablecer acceso al portal':'Suspender acceso al portal',message:`${account.alias}: se cerrarán todas sus sesiones y se invalidará su contraseña actual. Verifica la identidad y autorización del contacto antes de entregar un nuevo enlace.`,confirmLabel:action==='restablecer'?'Restablecer acceso':'Suspender acceso'}).pipe(takeUntilDestroyed(this.destroy)).subscribe(ok=>{
   if(!ok)return;this.link.set('');this.request(this.service.change(this.client.idCliente,account.id,action,{...fields,requestId}),r=>{if('token'in r)this.invitation(r,account.alias);},true);
  });
 }
 async copy(){try{await navigator.clipboard.writeText(this.link());}catch{this.error.set('Selecciona el enlace y cópialo manualmente.');}}
}
