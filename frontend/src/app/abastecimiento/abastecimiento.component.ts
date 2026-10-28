import { CommonModule } from '@angular/common';
import { Component, inject, signal, TemplateRef, viewChild } from '@angular/core';
import { bindTemplateDialog } from '../shared/template-dialog';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { forkJoin, finalize } from 'rxjs';
import { AbastecimientoService, ComparativoProveedor, EvaluacionProveedor, OrdenCompra, OrdenCompraDetalle, RecepcionCompra, RecepcionCompraDetalle, SolicitudCompra } from '../services/abastecimiento.service';
import { ProductoService } from '../services/producto.service';
import { ProveedorService } from '../services/proveedor.service';
import { Producto } from '../producto/producto.interface';
import { NotificationService } from '../shared/notification.service';

@Component({selector:'app-abastecimiento',standalone:true,imports:[CommonModule,ReactiveFormsModule,MatButtonModule,MatCardModule,MatFormFieldModule,MatIconModule,MatInputModule,MatSelectModule,MatTabsModule],templateUrl:'./abastecimiento.component.html',styleUrl:'./abastecimiento.component.css'})
export class AbastecimientoComponent{
 private readonly api=inject(AbastecimientoService);private readonly productsApi=inject(ProductoService);private readonly providersApi=inject(ProveedorService);private readonly fb=inject(FormBuilder);private readonly notifications=inject(NotificationService);
 readonly requests=signal<SolicitudCompra[]>([]);readonly orders=signal<OrdenCompra[]>([]);readonly receipts=signal<RecepcionCompra[]>([]);readonly products=signal<Producto[]>([]);readonly providers=signal<Array<{id:number;name:string}>>([]);readonly selected=signal<OrdenCompraDetalle|null>(null);readonly selectedReceipt=signal<RecepcionCompraDetalle|null>(null);readonly loading=signal(false);readonly showRequest=signal(false);readonly showOrder=signal(false);readonly showCost=signal(false);readonly showReturn=signal(false);readonly ratings=signal<EvaluacionProveedor[]>([]);readonly quotes=signal<ComparativoProveedor[]>([]);
 readonly requestForm=this.fb.nonNullable.group({motivo:'',partidas:this.fb.array([this.requestLine()])});
 readonly orderForm=this.fb.nonNullable.group({idProveedor:[0,Validators.min(1)],fechaPromesa:'',notas:'',partidas:this.fb.array([this.orderLine()])});
 readonly receiptForm=this.fb.nonNullable.group({referencia:'',notas:'',partidas:this.fb.array([] as ReturnType<AbastecimientoComponent['receiptLine']>[])});
 readonly comparisonForm=this.fb.nonNullable.group({idProducto:[0,Validators.min(1)]});
 readonly ratingForm=this.fb.nonNullable.group({idProveedor:[0,Validators.min(1)],idOrden:[0],precio:[5,[Validators.min(1),Validators.max(5)]],entrega:[5,[Validators.min(1),Validators.max(5)]],calidad:[5,[Validators.min(1),Validators.max(5)]],atencion:[5,[Validators.min(1),Validators.max(5)]],comentario:''});
 readonly costForm=this.fb.nonNullable.group({tipo:'Flete',monto:[0,Validators.min(.01)],criterio:'Valor',notas:''});
 readonly returnForm=this.fb.nonNullable.group({motivo:['',[Validators.required,Validators.maxLength(500)]],partidas:this.fb.array([] as ReturnType<AbastecimientoComponent['returnLine']>[])});
 readonly receiptDialog=viewChild<TemplateRef<unknown>>('receiptDialog');readonly costDialog=viewChild<TemplateRef<unknown>>('costDialog');readonly returnDialog=viewChild<TemplateRef<unknown>>('returnDialog');
 constructor(){
  bindTemplateDialog(()=>!!this.selected(),this.receiptDialog,()=>this.selected.set(null),{ariaLabelledBy:'receipt-dialog-title'});
  bindTemplateDialog(()=>this.showCost()&&!!this.selectedReceipt(),this.costDialog,()=>{this.showCost.set(false);this.selectedReceipt.set(null);},{ariaLabelledBy:'cost-dialog-title'});
  bindTemplateDialog(()=>this.showReturn()&&!!this.selectedReceipt(),this.returnDialog,()=>{this.showReturn.set(false);this.selectedReceipt.set(null);},{ariaLabelledBy:'return-dialog-title'});
  this.load();forkJoin({p:this.productsApi.buscarProductos('',100),v:this.providersApi.getProveedores()}).subscribe(({p,v})=>{this.products.set(p);this.providers.set(v.map(x=>({id:Number(x.idProveedor),name:String(x.razonSocial)})));});}
 get requestLines(){return this.requestForm.controls.partidas as FormArray}get orderLines(){return this.orderForm.controls.partidas as FormArray}get receiptLines(){return this.receiptForm.controls.partidas as FormArray}
 requestLine(){return this.fb.nonNullable.group({idProducto:[0,Validators.min(1)],cantidad:[1,Validators.min(.000001)],costoEstimado:[0,Validators.min(0)],origen:'Manual'})}
 orderLine(){return this.fb.nonNullable.group({idProducto:[0,Validators.min(1)],cantidad:[1,Validators.min(.000001)],costoUnitario:[0,Validators.min(0)],tasaIva:.16})}
 receiptLine(idDetalle=0,cantidad=0){return this.fb.nonNullable.group({idDetalle,cantidad:[cantidad,[Validators.required,Validators.min(.000001)] ]})}
 get returnLines(){return this.returnForm.controls.partidas as FormArray}
 returnLine(idRecepcionDetalle=0,cantidad=0){return this.fb.nonNullable.group({idRecepcionDetalle,cantidad:[cantidad,[Validators.required,Validators.min(0)] ]})}
 load(){this.loading.set(true);forkJoin({r:this.api.solicitudes(),o:this.api.ordenes(),rc:this.api.recepciones(),e:this.api.evaluaciones()}).pipe(finalize(()=>this.loading.set(false))).subscribe({next:x=>{this.requests.set(x.r);this.orders.set(x.o);this.receipts.set(x.rc);this.ratings.set(x.e)},error:()=>this.notifications.show('No se pudo cargar abastecimiento.')});}
 addRequestLine(){this.requestLines.push(this.requestLine())}addOrderLine(){this.orderLines.push(this.orderLine())}removeLine(a:FormArray,i:number){if(a.length>1)a.removeAt(i)}
 saveRequest(){if(this.requestForm.invalid)return this.requestForm.markAllAsTouched();this.api.crearSolicitud({...this.requestForm.getRawValue(),requestId:crypto.randomUUID()}).subscribe({next:()=>{this.notifications.show('Solicitud creada.',3500,'info');this.showRequest.set(false);this.requestForm.reset({motivo:''});while(this.requestLines.length>1)this.requestLines.removeAt(1);this.load()},error:()=>this.notifications.show('No se pudo crear la solicitud.')})}
 authorize(id:number){this.api.autorizar(id).subscribe({next:()=>{this.notifications.show('Solicitud autorizada.',3500,'info');this.load()},error:()=>this.notifications.show('No se pudo autorizar.')})}
 saveOrder(){if(this.orderForm.invalid)return this.orderForm.markAllAsTouched();const raw=this.orderForm.getRawValue();this.api.crearOrden({...raw,fechaPromesa:raw.fechaPromesa||undefined,requestId:crypto.randomUUID()}).subscribe({next:()=>{this.notifications.show('Orden emitida.',3500,'info');this.showOrder.set(false);this.load()},error:()=>this.notifications.show('No se pudo emitir la orden.')})}
 openReceipt(id:number){this.api.orden(id).subscribe({next:o=>{this.selected.set(o);this.receiptLines.clear();for(const p of o.partidas.filter(x=>Number(x.cantidad)>Number(x.cantidadRecibida)))this.receiptLines.push(this.receiptLine(p.idDetalle,Number(p.cantidad)-Number(p.cantidadRecibida)))},error:()=>this.notifications.show('No se pudo abrir la orden.')})}
 receiptProduct(index:number){const order=this.selected();const id=this.receiptLines.at(index)?.getRawValue().idDetalle;return order?.partidas.find(x=>x.idDetalle===id)}
 receive(){const order=this.selected();if(!order||this.receiptForm.invalid)return;this.api.recibir(order.idOrden,{...this.receiptForm.getRawValue(),requestId:crypto.randomUUID()}).subscribe({next:()=>{this.notifications.show('Recepción registrada e inventario actualizado.',4500,'info');this.selected.set(null);this.load()},error:()=>this.notifications.show('No se pudo registrar la recepción.')})}
 compare(){const id=this.comparisonForm.controls.idProducto.value;if(id>0)this.api.comparativo(id).subscribe(rows=>this.quotes.set(rows))}
 saveRating(){if(this.ratingForm.invalid)return this.ratingForm.markAllAsTouched();const raw=this.ratingForm.getRawValue();this.api.evaluar({...raw,idOrden:raw.idOrden>0?raw.idOrden:undefined}).subscribe({next:()=>{this.notifications.show('Evaluación guardada.',3500,'info');this.ratingForm.reset({idProveedor:0,idOrden:0,precio:5,entrega:5,calidad:5,atencion:5,comentario:''});this.load()},error:()=>this.notifications.show('No se pudo guardar la evaluación.')})}
 openReceiptActions(id:number,mode:'cost'|'return'){this.api.recepcion(id).subscribe({next:r=>{this.selectedReceipt.set(r);this.showCost.set(mode==='cost');this.showReturn.set(mode==='return');this.returnLines.clear();for(const p of r.partidas.filter(x=>Number(x.cantidadDisponible)>0))this.returnLines.push(this.returnLine(p.idDetalle,0))},error:()=>this.notifications.show('No se pudo abrir la recepción.')})}
 returnProduct(index:number){const receipt=this.selectedReceipt();const id=this.returnLines.at(index)?.getRawValue().idRecepcionDetalle;return receipt?.partidas.find(x=>x.idDetalle===id)}
 addCost(){const receipt=this.selectedReceipt();if(!receipt||this.costForm.invalid)return this.costForm.markAllAsTouched();this.api.agregarCosto(receipt.idRecepcion,{...this.costForm.getRawValue(),requestId:crypto.randomUUID()}).subscribe({next:()=>{this.notifications.show('Costo distribuido entre las partidas.',4000,'info');this.showCost.set(false);this.selectedReceipt.set(null);this.costForm.reset({tipo:'Flete',monto:0,criterio:'Valor',notas:''});this.load()},error:()=>this.notifications.show('No se pudo distribuir el costo.')})}
 returnToProvider(){const receipt=this.selectedReceipt();if(!receipt||this.returnForm.invalid)return this.returnForm.markAllAsTouched();const raw=this.returnForm.getRawValue();const partidas=raw.partidas.filter(x=>x.cantidad>0);if(!partidas.length)return this.notifications.show('Captura al menos una cantidad a devolver.');this.api.devolverProveedor({requestId:crypto.randomUUID(),idRecepcion:receipt.idRecepcion,motivo:raw.motivo,partidas}).subscribe({next:()=>{this.notifications.show('Devolución registrada y existencia actualizada.',4500,'info');this.showReturn.set(false);this.selectedReceipt.set(null);this.load()},error:()=>this.notifications.show('No se pudo registrar la devolución.')})}
}
