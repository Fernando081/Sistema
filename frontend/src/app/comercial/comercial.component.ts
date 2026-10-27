import { CommonModule } from '@angular/common';
import { Component,inject,signal } from '@angular/core';
import { FormBuilder,ReactiveFormsModule,Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { finalize,forkJoin } from 'rxjs';
import { Cliente } from '../cliente/cliente.interface';
import { Producto } from '../producto/producto.interface';
import { ClienteService } from '../services/cliente.service';
import { AutorizacionComercial,ClienteComercial,ComercialService,OperacionComercial,SimulacionPrecio } from '../services/comercial.service';
import { ProductoService } from '../services/producto.service';
import { NotificationService } from '../shared/notification.service';
import { AuthService } from '../auth/auth.service';
import { ApprovalPolicyComponent,commercialError } from './approval-policy.component';
@Component({selector:'app-comercial',standalone:true,imports:[CommonModule,ReactiveFormsModule,MatButtonModule,MatCardModule,MatCheckboxModule,MatFormFieldModule,MatIconModule,MatInputModule,MatSelectModule,MatTabsModule,ApprovalPolicyComponent],templateUrl:'./comercial.component.html',styleUrl:'./comercial.component.css'})
export class ComercialComponent{
 private api=inject(ComercialService);private clientsApi=inject(ClienteService);private productsApi=inject(ProductoService);private fb=inject(FormBuilder);private notice=inject(NotificationService);private auth=inject(AuthService);
 readonly isAdmin=this.auth.getSessionIdentity()?.role==='admin';readonly tab=signal(0);readonly loading=signal(false);readonly busy=signal(false);readonly error=signal('');
 readonly clients=signal<Cliente[]>([]);readonly products=signal<Producto[]>([]);readonly policies=signal<ClienteComercial[]>([]);readonly approvals=signal<AutorizacionComercial[]>([]);
 readonly lists=signal<Array<{idLista:number;nombre:string;productos:number}>>([]);readonly simulation=signal<SimulacionPrecio|null>(null);readonly selectedClient=signal<ClienteComercial|null>(null);
 readonly resolution=signal<{approval:AutorizacionComercial;state:'Aprobada'|'Rechazada'}|null>(null);
 readonly simulator=this.fb.nonNullable.group({idCliente:[0,Validators.min(1)],idProducto:[0,Validators.min(1)],cantidad:[1,Validators.min(.000001)],precioPropuesto:[null as number|null,Validators.min(0)]});
 readonly policy=this.fb.nonNullable.group({idLista:0,limiteCredito:[0,Validators.min(0)],diasCredito:[0,[Validators.min(0),Validators.max(365)]],bloqueado:false,motivoBloqueo:''});
 readonly approval=this.fb.nonNullable.group({tipo:'Margen bajo',idCliente:[0,Validators.min(1)],idProducto:0,valorSolicitado:[0,Validators.min(0)],valorReferencia:[0,Validators.min(0)],
   operacionDestino:this.fb.nonNullable.control<OperacionComercial>('Venta'),montoOperacion:[null as number|null,[Validators.required,Validators.min(0),Validators.max(999999999999)]],motivo:['',[Validators.required,Validators.maxLength(1000)]]});
 readonly decision=this.fb.nonNullable.group({resolucion:['',[Validators.required,Validators.maxLength(1000)]],vigenciaHoras:[24,[Validators.required,Validators.min(1),Validators.max(720)]]});
 constructor(){this.load();}
 load(){this.loading.set(true);this.error.set('');forkJoin({c:this.clientsApi.getClientes(),products:this.productsApi.buscarProductos('',100),p:this.api.clientes(),a:this.api.autorizaciones(),l:this.api.listas()})
   .pipe(finalize(()=>this.loading.set(false))).subscribe({next:x=>{this.clients.set(x.c);this.products.set(x.products);this.policies.set(x.p);this.approvals.set(x.a);this.lists.set(x.l);},error:e=>this.error.set(commercialError(e))});}
 simulate(){if(this.simulator.invalid||this.busy())return;this.busy.set(true);this.error.set('');const raw=this.simulator.getRawValue();
   this.api.simular({...raw,precioPropuesto:raw.precioPropuesto??undefined}).pipe(finalize(()=>this.busy.set(false))).subscribe({next:r=>{this.simulation.set(r);this.approval.patchValue({tipo:r.requiereAutorizacionMargen?'Margen bajo':'Descuento',idCliente:raw.idCliente,idProducto:raw.idProducto,valorSolicitado:r.precioPropuesto,valorReferencia:r.requiereAutorizacionMargen?r.precioMinimo:r.precioSugerido});},error:e=>this.error.set(commercialError(e))});}
 editPolicy(c:ClienteComercial){this.selectedClient.set(c);const match=this.lists().find(x=>x.nombre===c.lista);this.policy.setValue({idLista:match?.idLista||0,limiteCredito:Number(c.limiteCredito),diasCredito:Number(c.diasCredito),bloqueado:c.bloqueado,motivoBloqueo:c.motivoBloqueo||''});}
 savePolicy(){const c=this.selectedClient();if(!c||this.policy.invalid||this.busy())return;this.busy.set(true);const r=this.policy.getRawValue();
   this.api.configurarCliente(c.idCliente,{...r,idLista:r.idLista||null}).pipe(finalize(()=>this.busy.set(false))).subscribe({next:()=>{this.notice.show('Política actualizada.',3500,'info');this.selectedClient.set(null);this.load();},error:e=>this.error.set(commercialError(e))});}
 requestApproval(){if(this.approval.invalid||this.busy()||this.loading())return;const r=this.approval.getRawValue();
   if(r.tipo!=='Exceso credito'&&!r.idProducto){this.error.set('Selecciona el producto de la excepción.');return;}
   this.busy.set(true);this.error.set('');this.api.solicitar({...r,idProducto:r.tipo==='Exceso credito'?undefined:r.idProducto})
     .pipe(finalize(()=>this.busy.set(false))).subscribe({next:()=>{this.notice.show('Autorización enviada.',3500,'info');this.approval.patchValue({motivo:''});this.load();},error:e=>this.error.set(commercialError(e))});}
 beginResolution(a:AutorizacionComercial,state:'Aprobada'|'Rechazada'){
   this.error.set('');this.decision.reset({resolucion:'',vigenciaHoras:24});
   if(state==='Rechazada'){this.resolution.set({approval:a,state});return;}
   this.busy.set(true);this.api.politicaAprobaciones().pipe(finalize(()=>this.busy.set(false))).subscribe({next:policy=>{
     const rule=policy.reglas.find(x=>x.operacion===a.operacionDestino&&x.tipo===a.tipo);this.decision.patchValue({vigenciaHoras:Math.min(24,rule?.vigenciaMaximaHoras??24)});this.resolution.set({approval:a,state});
   },error:e=>this.error.set(commercialError(e))});
 }
 resolve(){const selected=this.resolution();if(!selected||this.decision.invalid||this.busy())return;this.busy.set(true);this.error.set('');
   this.api.resolver(selected.approval.idAutorizacion,{...this.decision.getRawValue(),estado:selected.state}).pipe(finalize(()=>this.busy.set(false))).subscribe({next:()=>{this.notice.show(`Solicitud ${selected.state.toLowerCase()}.`,3500,'info');this.resolution.set(null);this.load();},error:e=>this.error.set(commercialError(e))});}
}
