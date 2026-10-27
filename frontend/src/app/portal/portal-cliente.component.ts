import { CommonModule } from '@angular/common';
import { Component,DestroyRef,inject,signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute,RouterLink } from '@angular/router';
import { finalize,Observable } from 'rxjs';
import { PortalDocument,PortalKind,PortalProfile,PortalPublication,PortalService,portalFileLabel } from './portal.service';
import { downloadDocument } from '../shared/document-download';
@Component({selector:'app-portal-cliente',standalone:true,imports:[CommonModule,FormsModule,RouterLink],templateUrl:'./portal-cliente.component.html',styleUrl:'./portal-cliente.component.css'})
export class PortalClienteComponent {
 private readonly service=inject(PortalService);private readonly destroy=inject(DestroyRef);private readonly route=inject(ActivatedRoute);
 readonly profile=signal<PortalProfile|null>(null);readonly rows=signal<PortalDocument[]>([]);readonly selected=signal<PortalDocument|null>(null);readonly busy=signal(false);readonly error=signal('');readonly notice=signal('');readonly activating=this.route.snapshot.routeConfig?.path==='portal/activar';
 readonly sections:Array<{id:PortalKind;name:string}>=[{id:'pedidos',name:'Pedidos'},{id:'cotizaciones',name:'Cotizaciones'},{id:'facturas',name:'Documentos de venta'},{id:'unidades',name:'Mis unidades'},{id:'garantias',name:'Garantías'}];
 kind:PortalKind='pedidos';page=1;total=0;q='';alias='';password='';repeat='';current='';showPassword=false;private invitation='';
 readonly files=signal<PortalPublication[]>([]);filesActive=false;readonly fileLabel=portalFileLabel;
 constructor(){
  if(this.activating){const params=new URLSearchParams(window.location.hash.slice(1));this.invitation=params.get('token')??'';history.replaceState(history.state,'',window.location.pathname+window.location.search);if(!/^[\w-]{43}$/.test(this.invitation))this.error.set('Abre el enlace completo que te entregó el negocio.');}
  else this.restore(true);
  this.destroy.onDestroy(()=>{this.invitation='';this.password='';this.repeat='';this.current='';});
 }
 private failure(e:unknown){
  if(e instanceof HttpErrorResponse&&e.status===401){this.profile.set(null);this.rows.set([]);this.files.set([]);this.selected.set(null);}
  const body:unknown=e instanceof HttpErrorResponse?e.error:null;const message=body&&typeof body==='object'&&'message'in body?body.message:null;
  this.error.set(Array.isArray(message)?message.join('. '):typeof message==='string'?message:'No se pudo completar la solicitud. Reintenta.');
 }
 private request<T>(source:Observable<T>,next:(value:T)=>void,after?:()=>void,silentUnauthorized=false){
  if(this.busy())return;this.busy.set(true);this.error.set('');let ok=false;
  source.pipe(finalize(()=>{this.busy.set(false);if(ok&&!this.destroy.destroyed)after?.();}),takeUntilDestroyed(this.destroy)).subscribe({next:value=>{ok=true;next(value);},error:e=>{if(!(silentUnauthorized&&e instanceof HttpErrorResponse&&e.status===401))this.failure(e);}});
 }
 restore(silent=false){this.request(this.service.state(),p=>this.profile.set(p),()=>this.load(),silent);}
 login(){if(!this.alias.trim()||!this.password)return;this.notice.set('');this.request(this.service.login(this.alias.trim(),this.password),()=>{this.password='';this.q='';this.page=1;},()=>this.restore());}
 activate(){if(!this.invitation||this.password.length<12||this.password!==this.repeat){this.error.set('Revisa el enlace y confirma una contraseña de al menos12 caracteres.');return;}
  this.request(this.service.activate(this.invitation,this.password),()=>{this.invitation='';this.password='';this.repeat='';this.notice.set('Acceso activado. Inicia sesión con el alias que te entregó el negocio.');});
 }
 load(){this.selected.set(null);this.rows.set([]);this.files.set([]);this.total=0;if(this.filesActive){this.request(this.service.files(this.page,this.q.trim()),r=>{this.files.set(r.data);this.total=r.total;});return;}this.request(this.service.list(this.kind,this.page,this.q.trim()),r=>{this.rows.set(r.data);this.total=r.total;});}
 section(kind:PortalKind){if(this.busy())return;this.filesActive=false;this.kind=kind;this.q='';this.page=1;this.rows.set([]);this.load();}
 publishedFiles(){if(this.busy())return;this.filesActive=true;this.q='';this.page=1;this.load();}
 downloadFile(file:PortalPublication){this.request(this.service.file(file.id),blob=>downloadDocument(blob,`archivo-${file.id}-${file.clase}.${file.mime==='application/xml'?'xml':'pdf'}`));}
 search(){if(this.busy())return;this.page=1;this.load();}
 paginate(delta:number){if(this.busy())return;this.page+=delta;this.load();}
 open(id:number){this.request(this.service.one(this.kind,id),doc=>this.selected.set(doc));}
 download(){const doc=this.selected();if(doc)this.request(this.service.pdf(this.kind,doc.id),blob=>downloadDocument(blob,`resumen-${doc.id}.pdf`));}
 logout(){this.request(this.service.logout(),()=>{this.profile.set(null);this.rows.set([]);this.files.set([]);this.selected.set(null);this.password='';this.current='';this.repeat='';this.notice.set('Sesión del portal cerrada.');});}
 changePassword(){if(this.password!==this.repeat||this.password.length<12){this.error.set('Confirma la nueva contraseña de al menos12 caracteres.');return;}
  this.request(this.service.password(this.current,this.password),()=>{this.profile.set(null);this.rows.set([]);this.selected.set(null);this.password='';this.repeat='';this.current='';this.showPassword=false;this.notice.set('Contraseña actualizada. Inicia sesión nuevamente.');});
 }
}
