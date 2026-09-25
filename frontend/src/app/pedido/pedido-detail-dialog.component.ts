import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { finalize } from 'rxjs';
import { PedidoDetalle, PedidoService } from '../services/pedido.service';
import { ConfirmService } from '../shared/confirm.service';

@Component({ selector:'app-pedido-detail-dialog',standalone:true,imports:[CommonModule,FormsModule,MatDialogModule,MatButtonModule,MatIconModule],templateUrl:'./pedido-detail-dialog.component.html',styleUrl:'./pedido-detail-dialog.component.css' })
export class PedidoDetailDialogComponent {
  private readonly service=inject(PedidoService);private readonly destroyRef=inject(DestroyRef);private readonly ref=inject(MatDialogRef<PedidoDetailDialogComponent>);private readonly confirmService=inject(ConfirmService);private readonly snack=inject(MatSnackBar);
  readonly id=inject<number>(MAT_DIALOG_DATA);readonly order=signal<PedidoDetalle|null>(null);readonly busy=signal(true);readonly error=signal('');readonly quantities=new Map<number,number>();private changed=false;
  constructor(){this.load();}
  load(){this.busy.set(true);this.service.getOne(this.id).pipe(finalize(()=>this.busy.set(false)),takeUntilDestroyed(this.destroyRef)).subscribe({next:o=>{this.order.set(o);for(const p of o.partidas)this.quantities.set(p.idDetalle,Math.max(0,Number(p.cantidadReservada)-Number(p.cantidadSurtida)));},error:()=>this.error.set('No se pudo cargar el pedido.')});}
  confirm(){this.run(this.service.confirm(this.id),'Existencias apartadas');}
  deliver(){this.confirmService.ask({title:'Registrar entrega',message:'El pedido quedará marcado como entregado al cliente.',confirmLabel:'Registrar entrega'}).subscribe(ok=>{if(ok)this.run(this.service.deliver(this.id),'Entrega registrada');});}
  invoice(){this.confirmService.ask({title:'Facturar pedido',message:'Se generará la venta con los datos fiscales y condiciones de pago del cliente.',confirmLabel:'Generar factura'}).subscribe(ok=>{if(ok)this.run(this.service.invoice(this.id),'Pedido facturado');});}
  fulfill(){const partidas=[...this.quantities].filter(([,q])=>q>0).map(([idDetalle,cantidad])=>({idDetalle,cantidad}));if(!partidas.length){this.error.set('Indica al menos una cantidad para surtir.');return;}this.run(this.service.fulfill(this.id,partidas),'Surtido actualizado');}
  cancel(){this.confirmService.ask({title:'Cancelar pedido',message:'Se liberarán todas las existencias apartadas y se cancelarán sus backorders.',confirmLabel:'Cancelar pedido'}).subscribe(ok=>{if(ok)this.run(this.service.cancel(this.id),'Pedido cancelado');});}
  close(){this.ref.close(this.changed);}
  private run(request:any,message:string){if(this.busy())return;this.busy.set(true);this.error.set('');request.pipe(finalize(()=>this.busy.set(false)),takeUntilDestroyed(this.destroyRef)).subscribe({next:()=>{this.changed=true;this.snack.open(message,'Cerrar',{duration:2500});this.load();},error:(e:any)=>this.error.set(e.error?.message||'No se pudo completar la operación.')});}
}
