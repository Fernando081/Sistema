import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { catchError, debounceTime, finalize, of, switchMap } from 'rxjs';
import { CrmService, MOTIVOS_CRM, Oportunidad } from '../services/crm.service';
import { ProductoService } from '../services/producto.service';
import { Producto } from '../producto/producto.interface';
import { ConfirmDialogComponent } from '../shared/confirm-dialog.component';

@Component({
  selector: 'app-crm-venta-perdida-dialog', standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatAutocompleteModule, MatButtonModule, MatDialogModule,
    MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <h2 mat-dialog-title>Registrar venta perdida</h2>
    <mat-dialog-content>
      @if (data) {<p>Cuenta: <strong>{{ data.empresa }}</strong></p>}
      <p class="text-gray-500 mb-4">Conserva la solicitud aunque la refacción aún no exista en tu catálogo.</p>
      @if (error()) {<p role="alert" class="text-red-700">{{ error() }}</p>}
      <form id="venta-perdida-form" [formGroup]="form" (ngSubmit)="guardar()" class="grid grid-cols-1 gap-3 pt-2">
        <mat-form-field><mat-label>Vincular producto del catálogo (opcional)</mat-label><input matInput [formControl]="productoControl" [matAutocomplete]="auto" maxlength="150"><mat-autocomplete #auto="matAutocomplete" [displayWith]="displayProducto">@for (p of productos(); track p.idProducto) {<mat-option [value]="p">{{ p.codigo }} · {{ p.descripcion }}</mat-option>}</mat-autocomplete><mat-hint>Busca por código, número de parte o descripción</mat-hint></mat-form-field>
        <mat-form-field><mat-label>Refacción / número de parte / aplicación solicitada</mat-label><textarea matInput formControlName="descripcionBuscada" maxlength="255" rows="2"></textarea><mat-error>Describe la refacción solicitada</mat-error></mat-form-field>
        <mat-form-field><mat-label>Cantidad</mat-label><input matInput type="number" min="0.000001" step="0.000001" formControlName="cantidad"><mat-error>La cantidad debe ser mayor que cero</mat-error></mat-form-field>
        <mat-form-field><mat-label>Motivo</mat-label><mat-select formControlName="motivo">@for (motivo of motivos; track motivo) {<mat-option [value]="motivo">{{ motivo }}</mat-option>}</mat-select></mat-form-field>
        <mat-form-field><mat-label>Notas: marca, motor, año, precio o plazo solicitado</mat-label><textarea matInput formControlName="notas" maxlength="2000" rows="3"></textarea></mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end"><button mat-button [disabled]="busy()" (click)="cerrar()">Cancelar</button><button mat-flat-button form="venta-perdida-form" type="submit" [disabled]="busy()">Guardar solicitud</button></mat-dialog-actions>
  `,
})
export class CrmVentaPerdidaDialogComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly crm = inject(CrmService);
  private readonly productoService = inject(ProductoService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ref = inject(MatDialogRef<CrmVentaPerdidaDialogComponent>);
  private readonly dialogs = inject(MatDialog);
  readonly data = inject<Oportunidad | null>(MAT_DIALOG_DATA);
  readonly motivos = MOTIVOS_CRM;
  readonly busy = signal(false);
  readonly error = signal('');
  readonly productos = signal<Producto[]>([]);
  readonly productoControl = new FormControl<Producto | string>('');
  readonly form = this.fb.nonNullable.group({
    descripcionBuscada: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(255)]],
    cantidad: [1, [Validators.required, Validators.min(0.000001)]], motivo: ['Sin existencia', Validators.required], notas: ['', Validators.maxLength(2000)],
  });
  readonly displayProducto = (p: Producto | string | null) => typeof p === 'object' && p ? `${p.codigo} · ${p.descripcion}` : p || '';
  ngOnInit() {
    this.productoControl.valueChanges.pipe(debounceTime(250), switchMap(value =>
      typeof value === 'string' && value.trim().length >= 2
        ? this.productoService.buscarProductos(value.trim(), 20).pipe(catchError(() => of([]))) : of([])),
    takeUntilDestroyed(this.destroyRef)).subscribe(rows => this.productos.set(rows));
  }
  guardar() {
    if (this.busy()) return;
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.busy.set(true); this.error.set('');
    const producto = this.productoControl.value;
    this.crm.registrarVentaPerdida({ ...this.form.getRawValue(), idOportunidad: this.data?.idOportunidad,
      idProducto: typeof producto === 'object' && producto ? producto.idProducto : undefined })
      .pipe(finalize(() => this.busy.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => this.ref.close(true), error: () => this.error.set('No se pudo guardar la solicitud. Revisa los datos e inténtalo de nuevo.'),
      });
  }
  cerrar() {
    if (this.busy()) return;
    if (!this.form.dirty && !this.productoControl.dirty) { this.ref.close(false); return; }
    this.dialogs.open(ConfirmDialogComponent, { data: { message: 'Hay una solicitud sin guardar. ¿Deseas descartarla?' } })
      .afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(confirmed => { if (confirmed) this.ref.close(false); });
  }
}
