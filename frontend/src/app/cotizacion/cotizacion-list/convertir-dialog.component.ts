import { Component, Inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { FormaPago, MetodoPago } from '../../services/catalogos.service';
import { CotizacionService } from '../../services/cotizacion.service';

export interface ConvertirDialogData {
  idCotizacion: number;
  folio: string;
  formasPago: FormaPago[];
  metodosPago: MetodoPago[];
}

export interface ConceptoForm {
  idConcepto: number;
  idProducto: number;
  descripcion: string;
  cantidad: number;
  precioOriginal: number;
  
  // Signal-like states
  seleccionado: boolean;
  precioFinal: number;
  motivoRechazo: string;
}

@Component({
  selector: 'app-convertir-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatCheckboxModule,
    MatIconModule,
    FormsModule
  ],
  template: `
    <h2 mat-dialog-title class="flex items-center gap-2">
      <mat-icon class="text-[var(--c-text-3)]" aria-hidden="true">handshake</mat-icon> Convertir cotización C-{{ data.folio }} a venta
    </h2>
    <mat-dialog-content class="!pb-6 !pt-4">
      
      @if (isLoading()) {
        <div class="p-8 text-center text-[var(--c-text-3)]">Cargando partidas...</div>
      } @else {
        <div class="mb-4 text-sm text-[var(--c-text-2)]">
          Selecciona los artículos que el cliente realmente comprará. Ajusta el precio de cierre si aplicaste un descuento de último minuto. Para los artículos descartados, indica el motivo de rechazo.
        </div>

        <div class="overflow-x-auto w-full border rounded-lg shadow-sm mb-6">
          <table class="w-full text-sm text-left">
            <thead class="bg-[var(--c-surface-sunken)] text-[var(--c-text-2)] uppercase text-xs">
              <tr>
                <th scope="col" class="px-4 py-3 text-center w-12"><span class="sr-only">Incluir</span></th>
                <th scope="col" class="px-4 py-3">Descripción</th>
                <th scope="col" class="px-4 py-3 text-center">Cant.</th>
                <th scope="col" class="px-4 py-3 text-right">Precio original</th>
                <th scope="col" class="px-4 py-3 text-right">Condición de cierre</th>
              </tr>
            </thead>
            <tbody>
              @for (item of conceptos(); track item.idConcepto) {
                <tr class="border-b hover:bg-[var(--c-surface-sunken)] transition-colors" [style.background-color]="item.seleccionado ? null : 'var(--c-danger-soft)'">
                  <td class="px-4 py-3 text-center">
                    <mat-checkbox [(ngModel)]="item.seleccionado" (change)="triggerRecalc()" [aria-label]="'Incluir ' + item.descripcion"></mat-checkbox>
                  </td>
                  <td class="px-4 py-3" [class.opacity-50]="!item.seleccionado" [class.line-through]="!item.seleccionado">
                    <span class="font-medium">{{ item.descripcion }}</span>
                  </td>
                  <td class="px-4 py-3 text-center font-bold" [class.opacity-50]="!item.seleccionado">{{ item.cantidad }}</td>
                  <td class="px-4 py-3 text-right" [class.opacity-50]="!item.seleccionado">{{ item.precioOriginal | currency }}</td>
                  <td class="px-4 py-3 text-right w-64">
                    @if (item.seleccionado) {
                      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-full">
                        <mat-label>Precio final</mat-label>
                        <input matInput type="number" step="0.01" min="0" [(ngModel)]="item.precioFinal" (change)="triggerRecalc()" (keyup)="triggerRecalc()">
                        <span matTextPrefix class="mr-1 text-[var(--c-text-3)]">$ &nbsp;</span>
                      </mat-form-field>
                    } @else {
                      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-full">
                        <mat-label>Motivo de rechazo</mat-label>
                        <mat-select [(ngModel)]="item.motivoRechazo" (selectionChange)="triggerRecalc()">
                          <mat-option value="Precio alto">Precio alto</mat-option>
                          <mat-option value="Tiempo de entrega muy largo">Tiempo de entrega largo</mat-option>
                          <mat-option value="Lo encontró en otra tienda">Lo encontró en otra tienda</mat-option>
                          <mat-option value="Ya no lo necesita">Ya no lo necesita</mat-option>
                          <mat-option value="Falta de presupuesto">Falta de presupuesto</mat-option>
                          <mat-option value="Otro">Otro</mat-option>
                        </mat-select>
                      </mat-form-field>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <div class="flex gap-4">
          <mat-form-field appearance="outline" class="flex-1">
            <mat-label>Forma de pago</mat-label>
            <mat-select [(ngModel)]="idFormaPago">
              @for (f of data.formasPago; track f.idFormaPago) {
                <mat-option [value]="f.idFormaPago">{{ f.clave }} - {{ f.nombre }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline" class="flex-1">
            <mat-label>Método de pago</mat-label>
            <mat-select [(ngModel)]="idMetodoPago">
              @for (m of data.metodosPago; track m.idMetodoDePago) {
                <mat-option [value]="m.idMetodoDePago">{{ m.clave }} - {{ m.nombre }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="!px-6 !py-4 border-t bg-[var(--c-surface-2)] flex flex-wrap justify-between gap-4 w-full">
       <div class="flex flex-col">
         <span class="text-xs text-[var(--c-text-3)]">Subtotal esperado sin impuestos</span><strong class="text-xl text-[var(--c-text)] tabular-nums">{{ dynamicSubtotal() | currency }}</strong>
       </div>
       <div class="flex flex-wrap gap-2 items-center">
         @if (!isConfirming()) {
           <button mat-stroked-button mat-dialog-close>Cancelar</button>
           <button mat-flat-button color="primary" (click)="isConfirming.set(true)" [disabled]="!esValido()">
             <mat-icon>check_circle</mat-icon> Efectuar venta
           </button>
         } @else {
           <span class="text-[var(--c-danger)] font-bold text-sm mr-2 hidden sm:block">¿Confirmar conversión irreversible?</span>
           <button mat-stroked-button color="primary" (click)="isConfirming.set(false)">No, regresar</button>
           <button mat-flat-button color="warn" (click)="ejecutar()">
             <mat-icon>warning</mat-icon> Sí, descontar existencia
           </button>
         }
       </div>
    </mat-dialog-actions>
  `
})
export class ConvertirDialogComponent implements OnInit {
  idFormaPago: number | null = null;
  idMetodoPago: number | null = null;

  isLoading = signal(true);
  isConfirming = signal(false);
  conceptos = signal<ConceptoForm[]>([]);
  
  // Re-evaluation trigger signal
  private recalcTrigger = signal(0);
  
  dynamicSubtotal = computed(() => {
    this.recalcTrigger(); // Depend on trigger
    return this.conceptos().reduce((acc, c) => acc + (c.seleccionado ? (c.precioFinal * c.cantidad) : 0), 0);
  });

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: ConvertirDialogData,
    private cotizacionService: CotizacionService,
    private dialogRef: MatDialogRef<ConvertirDialogComponent>
  ) {
    const pu = this.data.metodosPago.find(m => m.clave === 'PUE');
    if (pu) this.idMetodoPago = pu.idMetodoDePago;

    const ef = this.data.formasPago.find(f => f.clave === '01');
    if (ef) this.idFormaPago = ef.idFormaPago;
  }

  ngOnInit() {
    this.cotizacionService.getById(this.data.idCotizacion).subscribe({
      next: (res) => {
        const mapped: ConceptoForm[] = res.conceptos.map((x) => ({
          idConcepto: x.id_concepto,
          idProducto: x.id_producto,
          descripcion: x.descripcion,
          cantidad: Number(x.cantidad),
          precioOriginal: Number(x.precio),
          seleccionado: true,
          precioFinal: Number(x.precio),
          motivoRechazo: ''
        }));
        this.conceptos.set(mapped);
        this.isLoading.set(false);
      },
      error: () => {
         this.isLoading.set(false);
      }
    });
  }

  triggerRecalc() {
    this.recalcTrigger.update(v => v + 1);
  }

  esValido(): boolean {
    if (!this.idFormaPago || !this.idMetodoPago) return false;
    
    const cons = this.conceptos();
    const aceptados = cons.filter(c => c.seleccionado);
    if (aceptados.length === 0) return false; // NADA QUE VENDER
    
    // Todos los rechazados deben tener motivo
    const rechazados = cons.filter(c => !c.seleccionado);
    if (rechazados.some(c => !c.motivoRechazo || c.motivoRechazo.trim() === '')) return false;

    // Todos los aceptados deben tener precioFinal valido (>=0)
    if (aceptados.some(c => !Number.isFinite(c.precioFinal) || c.precioFinal < 0)) return false;

    return true;
  }

  ejecutar() {
    if (!this.esValido()) return;

    const cons = this.conceptos();
    
    const articulosAceptados = cons.filter(c => c.seleccionado).map(c => ({
      idConcepto: c.idConcepto,
      precioCierre: c.precioFinal
    }));

    const articulosRechazados = cons.filter(c => !c.seleccionado).map(c => ({
      idConcepto: c.idConcepto,
      motivoRechazo: c.motivoRechazo
    }));

    const payload = {
      idFormaPago: this.idFormaPago,
      idMetodoPago: this.idMetodoPago,
      articulosAceptados,
      articulosRechazados
    };

    this.dialogRef.close(payload);
  }
}
