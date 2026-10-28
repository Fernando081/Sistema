import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { finalize } from 'rxjs';
import { VentaService } from '../../services/venta.service';
import { DetalleFacturaDb } from '../venta.interface';

@Component({
  selector: 'app-devolucion-dialog', standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <h2 mat-dialog-title>Devolución de mercancía</h2>
    <mat-dialog-content [formGroup]="form" class="space-y-4">
      <p>{{data.item.descripcion_producto}}</p>
      <p class="text-sm">Disponible para devolver: {{available}}. El reembolso se calcula con los importes originales de la venta.</p>
      <mat-form-field class="w-full"><mat-label>Cantidad a devolver</mat-label><input matInput type="number" formControlName="cantidad" min="0.0001" [max]="available"><mat-error>Ingresa una cantidad mayor a cero y menor o igual a {{available}}.</mat-error></mat-form-field>
      <mat-form-field class="w-full"><mat-label>Reembolso</mat-label><mat-select formControlName="metodoReembolso"><mat-option value="Saldo a Favor">Saldo a favor del cliente</mat-option><mat-option value="Efectivo">Devolución de efectivo</mat-option></mat-select></mat-form-field>
      <p class="text-sm text-[var(--c-text-3)]">Al registrar, se reintegrará la cantidad al inventario y quedará constancia de la devolución.</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end"><button mat-button (click)="ref.close()" [disabled]="saving()">Cancelar</button><button mat-flat-button (click)="save()" [disabled]="form.invalid || saving()">{{saving() ? 'Registrando…' : 'Registrar devolución'}}</button></mat-dialog-actions>`,
})
export class DevolucionDialogComponent {
  readonly data = inject<{ idFactura: number; item: DetalleFacturaDb }>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<DevolucionDialogComponent>);
  private readonly service = inject(VentaService);
  private readonly snack = inject(MatSnackBar);
  readonly available = Number(this.data.item.cantidad) - Number(this.data.item.cantidad_devuelta || 0);
  readonly saving = signal(false);
  readonly form = inject(FormBuilder).nonNullable.group({
    cantidad: [Math.min(1, this.available), [Validators.required, Validators.min(0.0001), Validators.max(this.available)]],
    metodoReembolso: this.methodControl(),
  });
  private methodControl() { return inject(FormBuilder).nonNullable.control<'Efectivo' | 'Saldo a Favor'>('Saldo a Favor', Validators.required); }
  save(): void {
    if (this.form.invalid || this.saving()) return;
    const {cantidad, metodoReembolso} = this.form.getRawValue();
    this.saving.set(true);
    this.ref.disableClose = true;
    this.service.devolver(this.data.idFactura, { metodoReembolso, articulos: [{ idProducto: this.data.item.id_producto, cantidad }] })
      .pipe(finalize(() => { this.saving.set(false); this.ref.disableClose = false; }))
      .subscribe({ next: () => { this.snack.open('Devolución registrada.', 'Cerrar'); this.ref.close(true); }, error: () => {} });
  }
}
