import { CommonModule } from '@angular/common';
import { CrmDocumentosComponent } from './crm-documentos.component';
import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { finalize, forkJoin, switchMap, tap } from 'rxjs';
import { CrmService, ETAPAS_CRM, Oportunidad, OportunidadDto, Seguimiento, UnidadCliente, UnidadClienteDto } from '../services/crm.service';
import { ConfirmDialogComponent } from '../shared/confirm-dialog.component';

export interface CrmOportunidadPrefill {
  idCliente: number;
  empresa: string;
  contacto?: string;
  email?: string;
}

@Component({
  selector: 'app-crm-oportunidad-dialog', standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatButtonModule, MatCardModule, MatCheckboxModule, MatDialogModule,
    MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, CrmDocumentosComponent],
  templateUrl: './crm-oportunidad-dialog.component.html',
})
export class CrmOportunidadDialogComponent implements OnInit {
  private readonly crm = inject(CrmService);
  private readonly fb = inject(FormBuilder);
  private readonly snack = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogs = inject(MatDialog);
  private readonly ref = inject(MatDialogRef<CrmOportunidadDialogComponent>);
  readonly data = inject<Oportunidad | CrmOportunidadPrefill | null>(MAT_DIALOG_DATA);
  private readonly existingItem = this.data && 'idOportunidad' in this.data ? this.data : null;
  readonly item = signal<Oportunidad | null>(this.existingItem);
  readonly webConsulta = signal<{ requestId: string; piezas: {code:string;brand?:string;quantity:number;application?:string}[] } | null>(null);
  readonly webError = signal(false);
  readonly webLoading = signal(false);
  cargarConsultaWeb() {
    const id = this.item()?.idOportunidad;
    if (!id) return;
    this.webError.set(false); this.webLoading.set(true);
    this.crm.getConsultaWeb(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: value => { this.webConsulta.set(value); this.webLoading.set(false); },
      error: () => { this.webConsulta.set(null); this.webLoading.set(false); this.webError.set(true); },
    });
  }
  readonly busy = signal(false);
  documentsWorking(value: boolean) {
    this.busy.set(value);
    if (value) this.form.disable({ emitEvent: false }); else this.form.enable({ emitEvent: false });
  }
  documentsChanged() {
    this.changed = true; this.form.disable({ emitEvent: false }); this.recargar();
  }
  readonly loadFailed = signal(false);
  readonly error = signal('');
  readonly historial = signal<Seguimiento[]>([]);
  readonly historyTotal = signal(0);
  readonly historyBusy = signal(false);
  readonly unidades = signal<UnidadCliente[]>([]);
  readonly unidadEditando = signal<UnidadCliente | null>(null);
  readonly unidadesBusy = signal(false);
  readonly etapas = ETAPAS_CRM;
  readonly tipos = ['Flotilla', 'Taller', 'Transportista', 'Mostrador', 'Otro'];
  readonly actividades = ['Llamada', 'WhatsApp', 'Correo', 'Visita', 'Nota'];
  historyPage = 1;
  private changed = false;
  readonly form = this.fb.nonNullable.group({
    idCliente: [null as number | null],
    empresa: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(180)]],
    contacto: ['', Validators.maxLength(150)], telefono: ['', Validators.maxLength(30)],
    email: ['', [Validators.email, Validators.maxLength(150)]],
    tipoCliente: ['Otro', Validators.required], etapa: ['Prospecto', Validators.required],
    montoEstimado: [0, [Validators.required, Validators.min(0), Validators.max(999999999999.99)]],
    siguienteAccion: ['', Validators.maxLength(255)], fechaSiguienteAccion: [''], motivoPerdida: ['', Validators.maxLength(100)],
  });
  readonly seguimiento = this.fb.nonNullable.group({
    tipo: ['Llamada', Validators.required], detalle: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(2000)]], completarAccion: [false],
  });
  readonly unidadForm = this.fb.group({
    vin: ['', [Validators.maxLength(17), Validators.pattern(/^[A-HJ-NPR-Za-hj-npr-z0-9\s-]*$/)]],
    esn: ['', [Validators.maxLength(50)]],
    numeroEconomico: ['', Validators.maxLength(50)], marca: ['', Validators.maxLength(80)],
    modelo: ['', Validators.maxLength(100)], anio: [null as number | null, [Validators.min(1900), Validators.max(2200)]],
    motor: ['', Validators.maxLength(120)], notas: ['', Validators.maxLength(1000)],
  });
  ngOnInit() {
    this.cargarConsultaWeb();
    if (this.existingItem) {
      this.recargar();
      return;
    }
    if (this.data) {
      this.form.patchValue({
        idCliente: this.data.idCliente,
        empresa: this.data.empresa,
        contacto: this.data.contacto || '',
        email: this.data.email || '',
      });
      this.form.markAsPristine();
    }
  }
  recargar() {
    const id = this.item()?.idOportunidad;
    if (!id || this.busy()) return;
    this.busy.set(true); this.error.set('');
    forkJoin({ item: this.crm.getOportunidad(id), history: this.crm.getSeguimientos(id), unidades: this.crm.getUnidades(id) })
      .pipe(finalize(() => { this.busy.set(false); this.form.enable({ emitEvent: false }); }), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: result => {
          this.loadFailed.set(false); this.setItem(result.item); this.historial.set(result.history.data);
          this.unidades.set(result.unidades);
          this.historyTotal.set(result.history.total); this.historyPage = 1;
        }, error: () => { this.loadFailed.set(true); this.error.set('No se pudo cargar la oportunidad. Intenta recargar.'); },
      });
  }
  editarUnidad(unidad?: UnidadCliente) {
    this.unidadEditando.set(unidad || null);
    this.unidadForm.reset({
      vin: unidad?.vin || '', esn: unidad?.esn || '', numeroEconomico: unidad?.numeroEconomico || '',
      marca: unidad?.marca || '', modelo: unidad?.modelo || '', anio: unidad?.anio || null,
      motor: unidad?.motor || '', notas: unidad?.notas || '',
    });
  }
  guardarUnidad() {
    const current = this.item();
    if (!current || this.unidadesBusy()) return;
    if (this.unidadForm.invalid) { this.unidadForm.markAllAsTouched(); return; }
    const raw = this.unidadForm.getRawValue();
    const vin = raw.vin?.replace(/[\s-]/g, '').toUpperCase() || null;
    const esn = raw.esn?.trim().toUpperCase() || null;
    if (!vin && !esn) { this.error.set('Captura el VIN del camión o el ESN del motor.'); return; }
    if (vin && vin.length !== 17) { this.error.set('El VIN debe contener exactamente 17 caracteres.'); return; }
    const dto: UnidadClienteDto = {
      vin, esn, numeroEconomico: raw.numeroEconomico?.trim() || null,
      marca: raw.marca?.trim() || null, modelo: raw.modelo?.trim() || null,
      anio: raw.anio || null, motor: raw.motor?.trim() || null, notas: raw.notas?.trim() || null,
    };
    const editing = this.unidadEditando();
    this.unidadesBusy.set(true); this.error.set('');
    const request = editing ? this.crm.actualizarUnidad(editing.idUnidad, dto) : this.crm.crearUnidad(current.idOportunidad, dto);
    request.pipe(switchMap(() => this.crm.getUnidades(current.idOportunidad)), finalize(() => this.unidadesBusy.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => { this.changed = true; this.unidades.set(result); this.editarUnidad(); this.cargarHistorial(true); this.snack.open('Unidad guardada', 'Cerrar', { duration: 2500 }); },
        error: error => this.error.set(error.error?.message || 'No se pudo guardar la unidad.'),
      });
  }
  eliminarUnidad(unidad: UnidadCliente) {
    this.dialogs.open(ConfirmDialogComponent, { data: { message: `¿Eliminar la unidad ${unidad.numeroEconomico || unidad.vin || unidad.esn}? Esta acción quedará registrada en el historial.` } })
      .afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(confirmed => {
        const current = this.item();
        if (!confirmed || !current) return;
        this.unidadesBusy.set(true);
        this.crm.eliminarUnidad(unidad.idUnidad).pipe(
          switchMap(() => this.crm.getUnidades(current.idOportunidad)), finalize(() => this.unidadesBusy.set(false)),
          takeUntilDestroyed(this.destroyRef),
        ).subscribe({ next: result => { this.changed = true; this.unidades.set(result); this.cargarHistorial(true); }, error: () => this.error.set('No se pudo eliminar la unidad.') });
      });
  }
  guardar() {
    if (this.busy() || this.loadFailed()) return;
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const raw = this.form.getRawValue();
    if (raw.etapa === 'Perdida' && !raw.motivoPerdida.trim()) {
      this.error.set('Indica el motivo de pérdida.'); return;
    }
    if (!['Ganada', 'Perdida'].includes(raw.etapa) && raw.fechaSiguienteAccion && !raw.siguienteAccion.trim()) {
      this.error.set('Describe la acción que deseas programar.'); return;
    }
    const dto: OportunidadDto = {
      ...raw, etapa: raw.etapa as Oportunidad['etapa'], empresa: raw.empresa.trim(),
      contacto: raw.contacto.trim() || null, telefono: raw.telefono.trim() || null, email: raw.email.trim() || null,
      siguienteAccion: raw.siguienteAccion.trim() || null, motivoPerdida: raw.motivoPerdida.trim() || null,
      fechaSiguienteAccion: raw.fechaSiguienteAccion ? new Date(raw.fechaSiguienteAccion).toISOString() : null,
    };
    const current = this.item();
    this.busy.set(true); this.error.set('');
    const request = current
      ? this.crm.actualizarOportunidad(current.idOportunidad, { ...dto, expectedVersion: current.version })
          .pipe(switchMap(() => this.crm.getOportunidad(current.idOportunidad)))
      : this.crm.crearOportunidad(dto).pipe(
          tap(result => { this.changed = true; this.item.set({ ...dto, idOportunidad: result.idOportunidad, version: 1, updatedAt: '' }); }),
          switchMap(result => this.crm.getOportunidad(result.idOportunidad)));
    request.pipe(finalize(() => this.busy.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => { this.changed = true; this.setItem(result); this.cargarHistorial(true); this.snack.open('Oportunidad guardada', 'Cerrar', { duration: 2500 }); },
      error: error => { this.error.set(error.status === 409 ? 'Otra persona modificó esta oportunidad. Recarga antes de guardar.' : 'No se pudo guardar. Revisa los datos e inténtalo de nuevo.'); },
    });
  }
  agregarSeguimiento() {
    const current = this.item();
    if (!current || this.busy() || this.form.dirty || this.loadFailed()) return;
    if (this.seguimiento.invalid) { this.seguimiento.markAllAsTouched(); return; }
    this.busy.set(true); this.error.set('');
    this.crm.agregarSeguimiento(current.idOportunidad, { ...this.seguimiento.getRawValue(), expectedVersion: current.version })
      .pipe(switchMap(() => this.crm.getOportunidad(current.idOportunidad)), finalize(() => this.busy.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => { this.changed = true; this.setItem(result); this.seguimiento.reset(); this.cargarHistorial(true); },
        error: error => this.error.set(error.status === 409 ? 'La oportunidad cambió. Recarga antes de registrar el seguimiento.' : 'No se pudo registrar el seguimiento.'),
      });
  }
  cargarHistorial(reset = false) {
    const current = this.item();
    if (!current || this.historyBusy()) return;
    const nextPage = reset ? 1 : this.historyPage + 1;
    this.historyBusy.set(true);
    this.crm.getSeguimientos(current.idOportunidad, nextPage)
      .pipe(finalize(() => this.historyBusy.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: result => { this.historyPage = nextPage; this.historial.set(reset ? result.data : [...this.historial(), ...result.data]); this.historyTotal.set(result.total); },
        error: () => this.error.set('No se pudo cargar el historial.'),
      });
  }
  cerrar() {
    if (this.busy()) return;
    if (!this.form.dirty && !this.seguimiento.dirty && !this.unidadForm.dirty) { this.ref.close(this.changed); return; }
    this.dialogs.open(ConfirmDialogComponent, { data: { message: 'Hay cambios sin guardar. ¿Deseas cerrar este formulario?' } })
      .afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(confirmed => { if (confirmed) this.ref.close(this.changed); });
  }
  private setItem(item: Oportunidad) {
    this.item.set(item);
    this.form.reset({ ...item, contacto: item.contacto || '', telefono: item.telefono || '', email: item.email || '',
      montoEstimado: Number(item.montoEstimado), siguienteAccion: item.siguienteAccion || '',
      motivoPerdida: item.motivoPerdida || '', fechaSiguienteAccion: this.localDate(item.fechaSiguienteAccion) });
  }
  private localDate(value?: string | null) {
    if (!value) return '';
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
}
