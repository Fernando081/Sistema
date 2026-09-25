import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { finalize, switchMap } from 'rxjs';
import { CrmService, UnidadCliente, UnidadClienteDto } from '../../services/crm.service';
import { ConfirmService } from '../../shared/confirm.service';

interface ClienteUnidadesData { idCliente: number; razonSocial: string; }

@Component({
  selector: 'app-cliente-unidades-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule,
    MatIconModule, MatInputModule, MatProgressSpinnerModule, MatSnackBarModule],
  templateUrl: './cliente-unidades-dialog.component.html',
  styleUrl: './cliente-unidades-dialog.component.css',
})
export class ClienteUnidadesDialogComponent {
  private readonly crm = inject(CrmService);
  private readonly fb = inject(FormBuilder);
  private readonly ref = inject(MatDialogRef<ClienteUnidadesDialogComponent>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly snack = inject(MatSnackBar);
  private readonly confirm = inject(ConfirmService);
  readonly data = inject<ClienteUnidadesData>(MAT_DIALOG_DATA);
  readonly unidades = signal<UnidadCliente[]>([]);
  readonly editando = signal<UnidadCliente | null>(null);
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly error = signal('');
  private changed = false;

  readonly form = this.fb.group({
    vin: ['', [Validators.maxLength(17), Validators.pattern(/^[A-HJ-NPR-Za-hj-npr-z0-9\s-]*$/)]],
    esn: ['', Validators.maxLength(50)],
    numeroEconomico: ['', Validators.maxLength(50)],
    marca: ['', Validators.maxLength(80)],
    modelo: ['', Validators.maxLength(100)],
    anio: [null as number | null, [Validators.min(1900), Validators.max(2200)]],
    motor: ['', Validators.maxLength(120)],
    notas: ['', Validators.maxLength(1000)],
  });

  constructor() { this.cargar(); }

  cargar() {
    this.cargando.set(true); this.error.set('');
    this.crm.getUnidadesCliente(this.data.idCliente)
      .pipe(finalize(() => this.cargando.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: result => this.unidades.set(result), error: () => this.error.set('No se pudieron cargar las unidades del cliente.') });
  }

  editar(unidad?: UnidadCliente) {
    this.editando.set(unidad || null);
    this.form.reset({
      vin: unidad?.vin || '', esn: unidad?.esn || '', numeroEconomico: unidad?.numeroEconomico || '',
      marca: unidad?.marca || '', modelo: unidad?.modelo || '', anio: unidad?.anio || null,
      motor: unidad?.motor || '', notas: unidad?.notas || '',
    });
    this.error.set('');
  }

  guardar() {
    if (this.form.invalid || this.guardando()) { this.form.markAllAsTouched(); return; }
    const raw = this.form.getRawValue();
    const vin = raw.vin?.replace(/[\s-]/g, '').toUpperCase() || null;
    const esn = raw.esn?.trim().toUpperCase() || null;
    if (!vin && !esn) { this.error.set('Captura el VIN del camión, el ESN del motor o ambos.'); return; }
    if (vin && vin.length !== 17) { this.error.set('El VIN debe contener exactamente 17 caracteres válidos.'); return; }
    if (esn && esn.length < 3) { this.error.set('El ESN debe contener al menos 3 caracteres.'); return; }
    const dto: UnidadClienteDto = {
      vin, esn, numeroEconomico: raw.numeroEconomico?.trim() || null, marca: raw.marca?.trim() || null,
      modelo: raw.modelo?.trim() || null, anio: raw.anio || null, motor: raw.motor?.trim() || null,
      notas: raw.notas?.trim() || null,
    };
    const current = this.editando();
    const request = current ? this.crm.actualizarUnidad(current.idUnidad, dto) : this.crm.crearUnidadCliente(this.data.idCliente, dto);
    this.guardando.set(true); this.error.set('');
    request.pipe(switchMap(() => this.crm.getUnidadesCliente(this.data.idCliente)), finalize(() => this.guardando.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => { this.changed = true; this.unidades.set(result); this.editar(); this.snack.open('Unidad guardada', 'Cerrar', { duration: 2500 }); },
        error: err => this.error.set(err.error?.message || 'No se pudo guardar la unidad. Revisa que el VIN o ESN no esté registrado.'),
      });
  }

  eliminar(unidad: UnidadCliente) {
    const nombre = unidad.numeroEconomico || unidad.vin || unidad.esn || 'seleccionada';
    this.confirm.ask({ title: 'Eliminar unidad', message: `Se eliminará la unidad ${nombre} de este cliente.`, confirmLabel: 'Eliminar unidad' })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe(confirmed => {
        if (!confirmed) return;
        this.crm.eliminarUnidad(unidad.idUnidad).pipe(switchMap(() => this.crm.getUnidadesCliente(this.data.idCliente)), takeUntilDestroyed(this.destroyRef))
          .subscribe({ next: result => { this.changed = true; this.unidades.set(result); }, error: () => this.error.set('No se pudo eliminar la unidad.') });
      });
  }

  cerrar() {
    if (!this.form.dirty) { this.ref.close(this.changed); return; }
    this.confirm.ask({ title: 'Cerrar sin guardar', message: 'Hay datos de la unidad sin guardar.', confirmLabel: 'Cerrar' })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe(confirmed => { if (confirmed) this.ref.close(this.changed); });
  }
}
