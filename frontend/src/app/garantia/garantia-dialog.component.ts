import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { finalize } from 'rxjs';
import { GarantiaService } from '../services/garantia.service';

export interface GarantiaDialogData {
  idFactura: number;
  idConcepto: number;
  producto: string;
  cantidadDisponible: number;
}

@Component({
  selector: 'app-garantia-dialog', standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatDialogModule, MatButtonModule,
    MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <h2 mat-dialog-title>Registrar garantía</h2>
    <mat-dialog-content [formGroup]="form">
      <p class="mb-3 text-sm">{{ data.producto }}</p>
      <mat-form-field class="w-full"><mat-label>Cantidad</mat-label>
        <input matInput type="number" formControlName="cantidad" [max]="data.cantidadDisponible">
        <mat-hint>Máximo vendido disponible: {{ data.cantidadDisponible }}</mat-hint>
      </mat-form-field>
      <mat-form-field class="w-full"><mat-label>Destino físico</mat-label>
        <mat-select formControlName="destinoProducto">
          <mat-option value="Revision">Área de revisión</mat-option>
          <mat-option value="Proveedor">Enviar a proveedor</mat-option>
          <mat-option value="Merma">Merma</mat-option>
          <mat-option value="Vendible">Vendible</mat-option>
        </mat-select>
      </mat-form-field>
      <mat-form-field class="w-full"><mat-label>Falla o motivo</mat-label>
        <textarea matInput rows="4" formControlName="motivo"></textarea>
      </mat-form-field>
      <mat-form-field class="w-full"><mat-label>Fecha compromiso</mat-label>
        <input matInput type="datetime-local" formControlName="fechaCompromiso">
        <mat-hint>Fecha límite prometida para diagnóstico o resolución.</mat-hint>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancelar</button>
      <button mat-flat-button color="primary" (click)="guardar()" [disabled]="form.invalid || guardando()">Registrar</button>
    </mat-dialog-actions>
  `,
})
export class GarantiaDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(GarantiaService);
  private readonly ref = inject(MatDialogRef<GarantiaDialogComponent>);
  readonly data = inject<GarantiaDialogData>(MAT_DIALOG_DATA);
  readonly guardando = signal(false);
  readonly form = this.fb.group({
    cantidad: [1, [Validators.required, Validators.min(0.0001), Validators.max(this.data.cantidadDisponible)]],
    destinoProducto: ['Revision', Validators.required],
    motivo: ['', [Validators.required, Validators.maxLength(255)]],
    fechaCompromiso: [this.defaultCommitment(), Validators.required],
  });

  guardar() {
    if (this.guardando() || this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.guardando.set(true);
    const value = this.form.getRawValue();
    this.service.create({
      idFactura: this.data.idFactura,
      idConcepto: this.data.idConcepto,
      cantidad: Number(value.cantidad),
      motivo: value.motivo!,
      destinoProducto: value.destinoProducto!,
      fechaCompromiso: new Date(value.fechaCompromiso!).toISOString(),
    }).pipe(finalize(() => this.guardando.set(false)))
      .subscribe({ next: () => this.ref.close(true), error: () => {} });
  }

  private defaultCommitment() {
    const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
  }
}
