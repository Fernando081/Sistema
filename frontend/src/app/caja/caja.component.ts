import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { finalize, Subject, switchMap, catchError, of } from 'rxjs';
import { CajaService, MovimientoCaja, ResumenCaja, TurnoCaja } from '../services/caja.service';

@Component({
  selector:'app-caja',standalone:true,
  imports:[CommonModule,FormsModule,MatButtonModule,MatFormFieldModule,MatInputModule,MatPaginatorModule,MatSnackBarModule],
  templateUrl:'./caja.component.html',
  styleUrls:['./caja.component.css'],
})
export class CajaComponent {
  private readonly service=inject(CajaService);
  private readonly snack=inject(MatSnackBar);
  private readonly destroyRef=inject(DestroyRef);
  private readonly movementRequests=new Subject<{id:number;page:number}>();
  readonly resumen=signal<ResumenCaja|null>(null);
  readonly loading=signal(false);
  readonly saving=signal(false);
  readonly movimientos=signal<MovimientoCaja[]>([]);
  readonly total=signal(0);
  readonly selected=signal<TurnoCaja|null>(null);
  contado: number|null=null;
  notas='';
  pageIndex=0;

  constructor() {
    this.movementRequests.pipe(switchMap(({id,page})=>this.service.movimientos(id,page).pipe(catchError(()=>of({data:[],total:0})))),takeUntilDestroyed(this.destroyRef))
      .subscribe(result=>{this.movimientos.set(result.data);this.total.set(result.total);});
    this.cargar();
  }
  cargar() {
    if(this.loading()) return;
    this.loading.set(true);
    this.service.resumen().pipe(finalize(()=>this.loading.set(false)),takeUntilDestroyed(this.destroyRef)).subscribe({
      next:value=>{this.resumen.set(value);const selected=value.historial.find(row=>row.id_turno===this.selected()?.id_turno)??value.turno;
        if(selected)this.ver(selected);},error:()=>{},
    });
  }
  guardar() {
    const resumen=this.resumen();
    if(!resumen||this.saving()||this.contado===null||!Number.isFinite(this.contado)||this.contado<0)return;
    this.saving.set(true);
    const request=resumen.turno?this.service.cerrar(resumen.turno.id_turno,this.contado,this.notas):this.service.abrir(this.contado,this.notas);
    request.pipe(finalize(()=>this.saving.set(false)),takeUntilDestroyed(this.destroyRef)).subscribe({
      next:turno=>{this.snack.open(turno.estado==='Abierta'?'Caja abierta':'Cierre guardado','Cerrar',{duration:3500});this.contado=null;this.notas='';this.selected.set(turno);this.cargar();},
      error:()=>this.cargar(),
    });
  }
  ver(turno:TurnoCaja) {this.selected.set(turno);this.pageIndex=0;this.movementRequests.next({id:turno.id_turno,page:1});}
  paginar(event:PageEvent) {const turno=this.selected();if(turno){this.pageIndex=event.pageIndex;this.movementRequests.next({id:turno.id_turno,page:event.pageIndex+1});}}
  diferenciaApertura(resumen:ResumenCaja) {return Number(resumen.turno?.contado_apertura??0)-Number(resumen.turno?.saldo_sistema_apertura??0);}
}
