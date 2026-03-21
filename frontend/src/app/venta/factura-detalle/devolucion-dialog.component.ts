import { Component, Inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatRadioModule } from '@angular/material/radio';
import { FormsModule } from '@angular/forms';
import { VentaService } from '../../services/venta.service';

export interface DevolucionItem {
  idProducto: number;
  descripcion: string;
  cantidadComprada: number;
  cantidadADevolver: number;
  precioUnitario: number;
}

@Component({
  selector: 'app-devolucion-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatRadioModule,
    FormsModule
  ],
  template: `
    <h2 mat-dialog-title class="font-bold flex items-center gap-2 text-indigo-600 dark:text-white">
      <mat-icon>assignment_return</mat-icon> Nueva Devolución / Nota de Crédito Parcial
    </h2>
    <mat-dialog-content class="!pb-6 !pt-4 min-w-[900px]">
      
      <div class="mb-4 text-sm text-gray-600 dark:text-gray-300">
        Indique únicamente la cantidad de piezas físicas que el cliente está devolviendo de la <b>Factura F-{{ data.folio }}</b>. El monto total será reembolsado e impactará la contabilidad según el método elegido.
      </div>

      <div class="overflow-x-auto w-full border dark:border-slate-700 rounded-lg shadow-sm mb-6">
        <table class="w-full text-sm text-left">
          <thead class="bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 uppercase text-xs">
            <tr>
              <th scope="col" class="px-4 py-3">Código/Producto</th>
              <th scope="col" class="px-4 py-3 text-center">Cant. Comprada</th>
              <th scope="col" class="px-4 py-3 text-right">Precio Unitario</th>
              <th scope="col" class="px-4 py-3 text-left w-48">Pzas. a Devolver</th>
              <th scope="col" class="px-4 py-3 text-right">Reembolso</th>
            </tr>
          </thead>
          <tbody>
            @for (item of items(); track item.idProducto) {
              <tr class="border-b dark:border-slate-700 hover:bg-black/5 dark:hover:bg-white/5 transition-colors" [class.bg-indigo-50]="item.cantidadADevolver > 0">
                <td class="px-4 py-3">
                  <span class="font-medium dark:text-gray-100">{{ item.descripcion }}</span>
                </td>
                <td class="px-4 py-3 text-center font-bold text-gray-500 dark:text-gray-400">{{ item.cantidadComprada }}</td>
                <td class="px-4 py-3 text-right text-gray-600 dark:text-gray-400 mb-0">{{ item.precioUnitario | currency }}</td>
                <td class="px-4 py-3">
                  <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-full">
                    <input matInput type="number" min="0" [max]="item.cantidadComprada" 
                           [(ngModel)]="item.cantidadADevolver" 
                           (ngModelChange)="validarCantidad(item)" 
                           (change)="triggerRecalc()" 
                           (keyup)="triggerRecalc()">
                  </mat-form-field>
                </td>
                <td class="px-4 py-3 text-right font-bold text-indigo-600 dark:text-indigo-400">
                  {{ (item.cantidadADevolver * item.precioUnitario) | currency }}
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <div class="flex gap-4 p-4 border rounded-lg bg-gray-50 dark:bg-slate-800 dark:border-slate-700 items-center justify-between">
        <div>
          <mat-label class="font-bold block mb-2 dark:text-white">Método de Reembolso:</mat-label>
          <mat-radio-group [(ngModel)]="metodoReembolso" class="flex gap-6">
            <mat-radio-button value="Efectivo" color="primary">Entregar Efectivo (Caja)</mat-radio-button>
            <mat-radio-button value="Saldo a Favor" color="primary">Saldo a Favor del Cliente</mat-radio-button>
          </mat-radio-group>
        </div>
      </div>

    </mat-dialog-content>
    <mat-dialog-actions align="end" class="!px-6 !py-4 border-t dark:border-slate-700 bg-gray-50 dark:bg-slate-900 flex justify-between w-full">
       <div class="text-lg flex items-center">
         Total a Reembolsar: <span class="font-bold text-indigo-600 ml-2 text-2xl">{{ dynamicSubtotal() | currency }}</span>
       </div>
       <div class="flex gap-2 items-center">
         @if (!isConfirming()) {
           <button mat-stroked-button mat-dialog-close>Cancelar</button>
           <button mat-flat-button color="primary" (click)="isConfirming.set(true)" [disabled]="!esValido()">
             <mat-icon>task_alt</mat-icon> Revisar Devolución
           </button>
         } @else {
           <span class="text-red-500 font-bold text-sm mr-2 hidden sm:block">¿Ejecutar CFDI Egreso irreversiblemente?</span>
           <button mat-stroked-button (click)="isConfirming.set(false)">Atrás</button>
           <button mat-flat-button color="warn" (click)="ejecutar()" [disabled]="isSaving()">
             <mat-icon>{{ isSaving() ? 'hourglass_empty' : 'receipt_long' }}</mat-icon> Confirmar
           </button>
         }
       </div>
    </mat-dialog-actions>
  `
})
export class DevolucionDialogComponent implements OnInit {
  isConfirming = signal(false);
  isSaving = signal(false);
  metodoReembolso = 'Saldo a Favor'; // Default safe option
  
  items = signal<DevolucionItem[]>([]);
  private recalcTrigger = signal(0);
  
  dynamicSubtotal = computed(() => {
    this.recalcTrigger();
    return this.items().reduce((acc, c) => acc + ((c.cantidadADevolver || 0) * c.precioUnitario), 0);
  });

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { idFactura: number; folio: string; conceptos: any[] },
    private dialogRef: MatDialogRef<DevolucionDialogComponent>
  ) {}

  ngOnInit() {
    const mapped: DevolucionItem[] = this.data.conceptos.map(c => ({
      idProducto: c.id_producto,
      descripcion: c.descripcion,
      cantidadComprada: Number(c.cantidad),
      precioUnitario: Number(c.precio_unitario),
      cantidadADevolver: 0 // Default to not returning anything
    }));
    this.items.set(mapped);
  }

  validarCantidad(item: DevolucionItem) {
    if (item.cantidadADevolver < 0) item.cantidadADevolver = 0;
    if (item.cantidadADevolver > item.cantidadComprada) {
      item.cantidadADevolver = item.cantidadComprada;
    }
    this.triggerRecalc();
  }

  triggerRecalc() {
    this.recalcTrigger.update(v => v + 1);
  }

  esValido(): boolean {
    if (this.dynamicSubtotal() <= 0) return false;
    if (!this.metodoReembolso) return false;
    return true;
  }

  ejecutar() {
    if (!this.esValido()) return;
    this.isSaving.set(true);

    const devolviendo = this.items().filter(i => i.cantidadADevolver > 0).map(i => ({
      idProducto: i.idProducto,
      cantidad: i.cantidadADevolver,
      precioUnitario: i.precioUnitario
    }));

    const payload = {
      metodoReembolso: this.metodoReembolso,
      articulos: devolviendo
    };

    this.dialogRef.close(payload);
  }
}
