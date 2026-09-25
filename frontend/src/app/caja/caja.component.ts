import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { finalize, Subject, switchMap, catchError, of } from 'rxjs';
import { CajaService, MovimientoCaja, ResumenCaja, TurnoCaja } from '../services/caja.service';

@Component({
  selector:'app-caja',standalone:true,
  imports:[CommonModule,FormsModule,MatButtonModule,MatCardModule,MatFormFieldModule,MatInputModule,MatPaginatorModule,MatSnackBarModule],
  templateUrl:'./caja.component.html',
  styles:[`:host{display:block;padding:24px;max-width:1400px;margin:auto}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px;margin:20px 0}mat-card{padding:20px}.amount{font-size:1.65rem;font-weight:650;margin:8px 0}.muted{opacity:.72}.toolbar{display:flex;justify-content:space-between;align-items:center;gap:16px}form{display:flex;gap:16px;flex-wrap:wrap;align-items:start}mat-form-field{min-width:220px}.notes{flex:1}.table-wrap{overflow:auto;margin:16px 0}table{width:100%;border-collapse:collapse;text-align:left}th,td{padding:12px;border-bottom:1px solid #8883;white-space:nowrap}.negative{color:#c62828}.positive{color:#2e7d32}.warning{padding:12px;background:#ffb30018;border-left:3px solid #ffb300;margin:12px 0}`],
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
