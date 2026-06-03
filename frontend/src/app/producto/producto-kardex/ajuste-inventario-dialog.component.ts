// frontend/src/app/producto/producto-kardex/ajuste-inventario-dialog.component.ts
import { Component, Inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ProductoService } from '../../services/producto.service';
import { Producto } from '../producto.interface';

@Component({
  selector: 'app-ajuste-inventario-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    MatProgressSpinnerModule
  ],
  template: `
    <h2 mat-dialog-title class="flex items-center gap-2 border-b pb-2 mb-0">
      <mat-icon class="text-indigo-600">tune</mat-icon>
      <span>Ajuste Manual de Inventario</span>
    </h2>

    <mat-dialog-content class="!pt-4 space-y-4">
      <div class="p-3 bg-indigo-50 dark:bg-indigo-950/30 rounded-lg text-xs text-indigo-900 dark:text-indigo-200 border border-indigo-100 dark:border-indigo-900">
        <p class="font-bold">Ajustando Stock para:</p>
        <p class="font-mono text-sm mt-0.5">{{ data.codigo }} - {{ data.descripcion }}</p>
        <p class="mt-1">Existencia actual: <span class="font-bold text-sm">{{ data.existencia }}</span> unidades</p>
      </div>

      <form [formGroup]="ajusteForm" class="space-y-4 pt-2">
        <div class="flex gap-4">
          <mat-form-field appearance="outline" class="flex-1">
            <mat-label>Cantidad</mat-label>
            <input matInput type="number" formControlName="cantidad" min="1" placeholder="Ej. 10">
            <mat-error *ngIf="ajusteForm.get('cantidad')?.hasError('required')">Requerido</mat-error>
            <mat-error *ngIf="ajusteForm.get('cantidad')?.hasError('min')">Debe ser mayor a 0</mat-error>
          </mat-form-field>

          <mat-form-field appearance="outline" class="flex-1">
            <mat-label>Tipo de Ajuste</mat-label>
            <mat-select formControlName="tipo">
              <mat-option value="ENTRADA POR AJUSTE">Entrada (Aumento)</mat-option>
              <mat-option value="SALIDA POR MERMA/AJUSTE">Salida (Disminución)</mat-option>
            </mat-select>
            <mat-error *ngIf="ajusteForm.get('tipo')?.hasError('required')">Requerido</mat-error>
          </mat-form-field>
        </div>

        <mat-form-field appearance="outline" class="w-full">
          <mat-label>Motivo del Ajuste</mat-label>
          <textarea matInput formControlName="motivo" rows="3" placeholder="Ej. Mercancía dañada en almacén / Sobrante detectado"></textarea>
          <mat-error *ngIf="ajusteForm.get('motivo')?.hasError('required')">El motivo es obligatorio</mat-error>
        </mat-form-field>
      </form>
    </mat-dialog-content>

    <mat-dialog-actions align="end" class="border-t !pt-2">
      <button mat-button [disabled]="isSaving()" (click)="dialogRef.close()">Cancelar</button>
      <button mat-flat-button color="primary" [disabled]="ajusteForm.invalid || isSaving()" (click)="guardarAjuste()">
        <mat-spinner diameter="18" color="accent" class="inline-block mr-2" *ngIf="isSaving()"></mat-spinner>
        <span>Aplicar Ajuste</span>
      </button>
    </mat-dialog-actions>
  `
})
export class AjusteInventarioDialogComponent {
  ajusteForm: FormGroup;
  isSaving = signal(false);

  constructor(
    public dialogRef: MatDialogRef<AjusteInventarioDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: Producto,
    private fb: FormBuilder,
    private productoService: ProductoService,
    private snackBar: MatSnackBar
  ) {
    this.ajusteForm = this.fb.group({
      cantidad: [null, [Validators.required, Validators.min(1)]],
      tipo: ['ENTRADA POR AJUSTE', Validators.required],
      motivo: ['', Validators.required]
    });
  }

  guardarAjuste() {
    if (this.ajusteForm.invalid) return;

    this.isSaving.set(true);
    const { cantidad, tipo, motivo } = this.ajusteForm.value;

    this.productoService.ajustarInventario(this.data.idProducto, cantidad, tipo, motivo).subscribe({
      next: (res) => {
        this.isSaving.set(false);
        this.snackBar.open('¡Ajuste aplicado correctamente!', 'Cerrar', { duration: 3000 });
        // Retornar la nueva existencia
        this.dialogRef.close({ success: true, nuevaExistencia: res.existencia });
      },
      error: (err) => {
        this.isSaving.set(false);
        this.snackBar.open('Error al aplicar ajuste: ' + (err.error?.message || err.message), 'Cerrar', { duration: 4000 });
      }
    });
  }
}
