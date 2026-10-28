import { Component, Inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { FiscalCancellation } from '../services/fiscal.service';

@Component({
  selector: 'app-fiscal-cancel-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  template: ` <h2 mat-dialog-title>Cancelar {{ data.label }}</h2>
    <mat-dialog-content>
      <p>
        Si el comprobante está timbrado, primero se enviará la solicitud al PAC. Inventario y saldos
        cambiarán cuando SAT confirme la cancelación.
      </p>
      <form [formGroup]="form" class="cancel-form">
        <mat-form-field appearance="outline">
          <mat-label>Motivo SAT</mat-label>
          <mat-select formControlName="motivo">
            <mat-option value="01">01 · Error con relación</mat-option>
            <mat-option value="02">02 · Error sin relación</mat-option>
            <mat-option value="03">03 · No se llevó a cabo la operación</mat-option>
            <mat-option value="04">04 · Operación nominativa en factura global</mat-option>
          </mat-select>
        </mat-form-field>
        @if (form.controls.motivo.value === '01') {
          <mat-form-field appearance="outline">
            <mat-label>UUID del comprobante sustituto</mat-label>
            <input matInput formControlName="folioSustitucion" autocomplete="off" />
            <mat-error>Captura un UUID válido.</mat-error>
          </mat-form-field>
        }
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="ref.close(null)">Volver</button>
      <button mat-flat-button color="warn" [disabled]="invalid" (click)="submit()">
        Solicitar cancelación
      </button>
    </mat-dialog-actions>`,
  styles: [
    `
      .cancel-form {
        display: grid;
        gap: 0.5rem;
        margin-top: 1rem;
        min-width: min(32rem, 78vw);
      }
      mat-form-field {
        width: 100%;
      }
    `,
  ],
})
export class FiscalCancelDialogComponent {
  readonly form = new FormGroup({
    motivo: new FormControl<'01' | '02' | '03' | '04'>('03', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    folioSustitucion: new FormControl('', { nonNullable: true }),
  });
  constructor(
    readonly ref: MatDialogRef<FiscalCancelDialogComponent>,
    @Inject(MAT_DIALOG_DATA) readonly data: { label: string },
  ) {}
  get invalid() {
    const replacement = this.form.controls.folioSustitucion.value.trim();
    return (
      this.form.invalid ||
      (this.form.controls.motivo.value === '01' &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          replacement,
        ))
    );
  }
  submit() {
    if (this.invalid) return;
    const value: FiscalCancellation = { motivo: this.form.controls.motivo.value };
    if (value.motivo === '01')
      value.folioSustitucion = this.form.controls.folioSustitucion.value.trim();
    this.ref.close(value);
  }
}
