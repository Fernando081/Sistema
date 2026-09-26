import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { forkJoin, finalize } from 'rxjs';
import { AbastecimientoService, OrdenCompra, OrdenCompraDetalle } from '../../services/abastecimiento.service';
import { CuentasProveedorService, SupplierDashboard, SupplierInvoice, SupplierInvoiceDetail } from '../../services/cuentas-proveedor.service';
import { NotificationService } from '../../shared/notification.service';
import { downloadDocument } from '../../shared/document-download';
import { PagoProveedorService } from '../../services/pago-proveedor.service';
import { ProveedorService } from '../../services/proveedor.service';

interface SupplierOptionRow { IdProveedor?:number; idProveedor?:number; RazonSocial?:string; razonSocial?:string }

@Component({
  selector:'app-cuentas-por-pagar',standalone:true,
  imports:[CommonModule,ReactiveFormsModule,MatButtonModule,MatCardModule,MatFormFieldModule,MatIconModule,MatInputModule,MatSelectModule,MatTabsModule],
  templateUrl:'./cuentas-por-pagar.component.html',styleUrl:'./cuentas-por-pagar.component.css',
})
export class CuentasPorPagarComponent {
  private readonly api=inject(CuentasProveedorService);private readonly supply=inject(AbastecimientoService);private readonly supplierApi=inject(ProveedorService);private readonly legacyApi=inject(PagoProveedorService);private readonly fb=inject(FormBuilder);private readonly notice=inject(NotificationService);
  readonly invoices=signal<SupplierInvoice[]>([]);readonly dashboard=signal<SupplierDashboard|null>(null);readonly orders=signal<OrdenCompra[]>([]);
  readonly selectedOrder=signal<OrdenCompraDetalle|null>(null);readonly selectedInvoice=signal<SupplierInvoiceDetail|null>(null);
  readonly suppliers=signal<SupplierOptionRow[]>([]);readonly legacyDebts=signal<any[]>([]);readonly legacySelected=signal<any|null>(null);
  readonly loading=signal(false);readonly saving=signal(false);readonly showInvoice=signal(false);readonly showAdvance=signal(false);readonly showCredit=signal(false);
  xmlText='';pdfFile?:File;
  readonly invoiceForm=this.fb.nonNullable.group({idOrden:[0,Validators.min(1)],serie:'',folio:['',Validators.required],uuid:'',fechaEmision:[new Date().toISOString().slice(0,10),Validators.required],fechaVencimiento:['',Validators.required],moneda:'MXN',tipoCambio:[1,Validators.min(.000001)],retenciones:[0,Validators.min(0)],observaciones:'',partidas:this.fb.array([] as ReturnType<CuentasPorPagarComponent['invoiceLine']>[])});
  readonly paymentForm=this.fb.nonNullable.group({fecha:[new Date().toISOString().slice(0,10),Validators.required],monto:[0,Validators.min(.01)],formaPago:'Transferencia',referencia:'',notas:'',idProgramacion:0});
  readonly scheduleForm=this.fb.nonNullable.group({fechaProgramada:['',Validators.required],monto:[0,Validators.min(.01)],notas:''});
  readonly advanceForm=this.fb.nonNullable.group({idProveedor:[0,Validators.min(1)],idFacturaProveedor:0,fecha:[new Date().toISOString().slice(0,10),Validators.required],monto:[0,Validators.min(.01)],montoAplicar:0,formaPago:'Transferencia',referencia:'',notas:''});
  readonly creditForm=this.fb.nonNullable.group({idProveedor:[0,Validators.min(1)],idFacturaProveedor:0,uuid:'',folio:['',Validators.required],fecha:[new Date().toISOString().slice(0,10),Validators.required],total:[0,Validators.min(.01)],montoAplicar:0,notas:''});
  readonly legacyPaymentForm=this.fb.nonNullable.group({monto:[0,Validators.min(.01)],formaPago:'Transferencia',referencia:'',notas:''});
  readonly providers=computed(()=>this.suppliers().map(p=>({id:Number(p.idProveedor??p.IdProveedor),name:String(p.razonSocial??p.RazonSocial)})).sort((a,b)=>a.name.localeCompare(b.name,'es')));
  constructor(){this.load();}
  get lines(){return this.invoiceForm.controls.partidas as FormArray}
  invoiceLine(p:{idDetalle:number;descripcion:string;cantidad:number;costoUnitario:number},quantity?:number){return this.fb.nonNullable.group({idOrdenDetalle:p.idDetalle,descripcion:p.descripcion,cantidad:[quantity??p.cantidad,Validators.min(.000001)],costoUnitario:[Number(p.costoUnitario),Validators.min(0)],tasaIva:[.16,Validators.min(0)]})}
  invoiceProduct(index:number){const id=this.lines.at(index)?.getRawValue().idOrdenDetalle;return this.selectedOrder()?.partidas.find(p=>p.idDetalle===id)}
  removeInvoiceLine(index:number){this.lines.removeAt(index)}
  eligibleInvoices(providerId:number){return this.invoices().filter(f=>Number(f.idProveedor)===Number(providerId)&&['Aprobada','Parcialmente pagada'].includes(f.estado))}
  get calculated(){const raw=this.lines.getRawValue();const subtotal=this.round(raw.reduce((s,p)=>s+p.cantidad*p.costoUnitario,0));const impuestos=this.round(raw.reduce((s,p)=>s+p.cantidad*p.costoUnitario*p.tasaIva,0));const total=this.round(subtotal+impuestos-this.invoiceForm.controls.retenciones.value);return{subtotal,impuestos,total}}
  private round(v:number){return Math.round((v+Number.EPSILON)*100)/100}
  load(){this.loading.set(true);forkJoin({i:this.api.invoices(),d:this.api.dashboard(),o:this.supply.ordenes(),p:this.supplierApi.getProveedores(),l:this.legacyApi.getAllDeuda()}).pipe(finalize(()=>this.loading.set(false))).subscribe({next:x=>{this.invoices.set(x.i);this.dashboard.set(x.d);this.orders.set(x.o);this.suppliers.set(x.p);this.legacyDebts.set((x.l as any).data||x.l)},error:()=>this.notice.show('No se pudieron cargar las cuentas por pagar.')})}
  selectOrder(id:number){if(!id)return;this.supply.orden(id).subscribe({next:o=>{this.selectedOrder.set(o);this.lines.clear();for(const p of o.partidas){const available=Math.max(0,Number(p.cantidadRecibida)-Number(p.cantidadFacturada||0));if(available>0)this.lines.push(this.invoiceLine(p,available))}this.invoiceForm.patchValue({idOrden:o.idOrden});if(!this.lines.length)this.notice.show('La orden no tiene cantidades recibidas pendientes de facturar.')},error:()=>this.notice.show('No se pudo abrir la orden.')})}
  onXml(event:Event){const file=(event.target as HTMLInputElement).files?.[0];if(!file){this.xmlText='';return}if(file.size>5_000_000){this.notice.show('El XML supera 5 MB.');return}file.text().then(text=>this.xmlText=text)}
  onPdf(event:Event){this.pdfFile=(event.target as HTMLInputElement).files?.[0]}
  saveInvoice(){const order=this.selectedOrder();if(!order||this.invoiceForm.invalid||!this.lines.length)return this.invoiceForm.markAllAsTouched();const raw=this.invoiceForm.getRawValue();this.saving.set(true);const payload={...raw,idProveedor:order.idProveedor,requestId:crypto.randomUUID(),uuid:raw.uuid||undefined,xml:this.xmlText||undefined,...this.calculated};this.api.create(payload).subscribe({next:r=>{const upload=this.pdfFile?this.api.uploadPdf(r.idFacturaProveedor,this.pdfFile):null;if(upload)upload.pipe(finalize(()=>this.finishInvoice(r))).subscribe({error:()=>this.notice.show('La factura se guardó, pero el PDF no pudo resguardarse.')});else this.finishInvoice(r)},error:e=>{this.saving.set(false);this.notice.show(e.error?.message||'No se pudo registrar la factura.')}})}
  private finishInvoice(result:{estado:string;discrepancias:number}){this.saving.set(false);this.notice.show(result.discrepancias?`Factura guardada con ${result.discrepancias} discrepancias.`:'Factura conciliada correctamente.',5000,'info');this.showInvoice.set(false);this.selectedOrder.set(null);this.lines.clear();this.xmlText='';this.pdfFile=undefined;this.load()}
  openInvoice(id:number){this.api.invoice(id).subscribe({next:x=>{this.selectedInvoice.set(x);const balance=Number(x.saldo_pendiente??x.saldo);this.paymentForm.patchValue({monto:balance,idProgramacion:0});this.scheduleForm.patchValue({monto:balance,fechaProgramada:x.fechaVencimiento});},error:()=>this.notice.show('No se pudo abrir la factura.')})}
  refreshInvoice(){const id=this.selectedInvoice()?.idFacturaProveedor;if(id)this.openInvoice(id)}
  resolve(id:number,estado:'Aprobada'|'Rechazada',reason:string){if(reason.trim().length<3)return this.notice.show('Escribe una justificación.');this.api.resolve(id,estado,reason.trim()).subscribe({next:()=>{this.notice.show('Discrepancia resuelta.');this.refreshInvoice();this.load()},error:e=>this.notice.show(e.error?.message||'No se pudo resolver.')})}
  approve(){const i=this.selectedInvoice();if(!i)return;this.api.approve(i.idFacturaProveedor).subscribe({next:()=>{this.notice.show('Factura aprobada y liberada para pago.',4500,'info');this.refreshInvoice();this.load()},error:e=>this.notice.show(e.error?.message||'No se pudo aprobar.')})}
  schedule(){const i=this.selectedInvoice();if(!i||this.scheduleForm.invalid)return;this.api.schedule(i.idFacturaProveedor,this.scheduleForm.getRawValue()).subscribe({next:()=>{this.notice.show('Pago programado.');this.refreshInvoice()},error:e=>this.notice.show(e.error?.message||'No se pudo programar.')})}
  pay(){const i=this.selectedInvoice();if(!i||this.paymentForm.invalid)return;const raw=this.paymentForm.getRawValue();this.saving.set(true);this.api.pay(i.idFacturaProveedor,{...raw,idProgramacion:raw.idProgramacion||undefined,requestId:crypto.randomUUID()}).pipe(finalize(()=>this.saving.set(false))).subscribe({next:()=>{this.notice.show('Pago registrado.',4000,'info');this.refreshInvoice();this.load()},error:e=>this.notice.show(e.error?.message||'No se pudo registrar el pago.')})}
  createAdvance(){if(this.advanceForm.invalid)return;const raw=this.advanceForm.getRawValue();this.api.advance({...raw,idFacturaProveedor:raw.idFacturaProveedor||undefined,montoAplicar:raw.montoAplicar||undefined,requestId:crypto.randomUUID()}).subscribe({next:()=>{this.notice.show('Anticipo registrado.');this.showAdvance.set(false);this.load()},error:e=>this.notice.show(e.error?.message||'No se pudo registrar el anticipo.')})}
  createCredit(){if(this.creditForm.invalid)return;const raw=this.creditForm.getRawValue();this.api.credit({...raw,idFacturaProveedor:raw.idFacturaProveedor||undefined,montoAplicar:raw.montoAplicar||undefined,uuid:raw.uuid||undefined,requestId:crypto.randomUUID()}).subscribe({next:()=>{this.notice.show('Nota de crédito registrada.');this.showCredit.set(false);this.load()},error:e=>this.notice.show(e.error?.message||'No se pudo registrar la nota.')})}
  download(id:number,type:'xml'|'pdf'){this.api[type](id).subscribe({next:blob=>downloadDocument(blob,`factura_proveedor_${id}.${type}`),error:()=>this.notice.show(`${type.toUpperCase()} no disponible.`)})}
  selectProgram(id:number,amount:number){this.paymentForm.patchValue({idProgramacion:id,monto:Number(amount)})}
  openLegacy(item:any){this.legacySelected.set(item);this.legacyPaymentForm.patchValue({monto:Number(item.saldo_pendiente),formaPago:'Transferencia',referencia:'',notas:''})}
  payLegacy(){const item=this.legacySelected();if(!item||this.legacyPaymentForm.invalid)return;this.saving.set(true);this.legacyApi.registrar({idCompra:item.id_compra,...this.legacyPaymentForm.getRawValue()}).pipe(finalize(()=>this.saving.set(false))).subscribe({next:()=>{this.notice.show('Pago histórico registrado.',4000,'info');this.legacySelected.set(null);this.load()},error:e=>this.notice.show(e.error?.message||'No se pudo registrar el pago.')})}
}
