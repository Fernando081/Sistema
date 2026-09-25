import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { EMPTY, Subject, catchError, debounceTime, distinctUntilChanged, finalize, map, of, startWith, switchMap } from 'rxjs';
import { CrmService, CrmResumen, ETAPAS_CRM, GlobalSearchItem, GlobalSearchResult, MOTIVOS_CRM, Oportunidad, VentaPerdida } from '../services/crm.service';
import { CrmOportunidadDialogComponent, CrmOportunidadPrefill } from './crm-oportunidad-dialog.component';
import { CrmVentaPerdidaDialogComponent } from './crm-venta-perdida-dialog.component';
import { ActivatedRoute, Router } from '@angular/router';
import { CrmOperativoComponent } from './crm-operativo.component';

@Component({
  selector: 'app-crm-pipeline', standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatButtonModule, MatCardModule, MatDialogModule,
    MatFormFieldModule, MatIconModule, MatInputModule, MatPaginatorModule, MatSelectModule,
    MatSnackBarModule, MatTableModule, MatTabsModule, MatButtonToggleModule, CrmOperativoComponent],
  templateUrl: './crm-pipeline.component.html',
  styleUrl: './crm-pipeline.component.css',
})
export class CrmPipelineComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly crm = inject(CrmService);
  private readonly snack = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly refresh = new Subject<void>();
  private readonly refreshPerdidas = new Subject<void>();
  readonly oportunidades = signal<Oportunidad[]>([]);
  readonly ventasPerdidas = signal<VentaPerdida[]>([]);
  readonly resumen = signal<CrmResumen | null>(null);
  readonly cargando = signal(false);
  readonly cargandoPerdidas = signal(false);
  readonly errorCarga = signal(false);
  readonly errorPerdidas = signal(false);
  readonly busquedaRelacionada = signal<GlobalSearchResult | null>(null);
  readonly buscandoRelacionado = signal(false);
  readonly total = signal(0);
  readonly totalPerdidas = signal(0);
  readonly etapas = ETAPAS_CRM;
  readonly motivos = MOTIVOS_CRM;
  readonly pipelineStages = ETAPAS_CRM;
  readonly vista = signal<'agenda' | 'pipeline'>('agenda');
  readonly columns = ['empresa', 'etapa', 'monto', 'siguiente', 'responsable', 'acciones'];
  readonly columnsPerdidas = ['fecha', 'producto', 'cantidad', 'motivo', 'empresa', 'notas'];
  readonly filtros = this.fb.nonNullable.group({ q: '', etapa: '', agenda: 'todas' });
  readonly filtrosPerdidas = this.fb.nonNullable.group({ q: '', motivo: '' });
  page = 0;
  pageSize = 25;
  pagePerdidas = 0;
  pageSizePerdidas = 25;

  ngOnInit() {
    const query = this.route.snapshot.queryParamMap;
    this.filtros.patchValue({ q: query.get('q') || '', agenda: query.get('agenda') || 'todas' }, { emitEvent: false });
    this.refresh.pipe(startWith(undefined), switchMap(() => {
      this.cargando.set(true); this.errorCarga.set(false);
      return this.crm.getOportunidades({ ...this.filtros.getRawValue(), page: this.page + 1, limit: this.pageSize })
        .pipe(catchError(() => { this.errorCarga.set(true); return EMPTY; }), finalize(() => this.cargando.set(false)));
    }), takeUntilDestroyed(this.destroyRef)).subscribe(result => { this.oportunidades.set(result.data); this.total.set(result.total); });
    this.refreshPerdidas.pipe(startWith(undefined), switchMap(() => {
      this.cargandoPerdidas.set(true); this.errorPerdidas.set(false);
      return this.crm.getVentasPerdidas({ ...this.filtrosPerdidas.getRawValue(), page: this.pagePerdidas + 1, limit: this.pageSizePerdidas })
        .pipe(catchError(() => { this.errorPerdidas.set(true); return EMPTY; }), finalize(() => this.cargandoPerdidas.set(false)));
    }), takeUntilDestroyed(this.destroyRef)).subscribe(result => { this.ventasPerdidas.set(result.data); this.totalPerdidas.set(result.total); });
    this.filtros.valueChanges.pipe(debounceTime(250), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => { this.page = 0; this.refresh.next(); });
    this.filtros.controls.q.valueChanges.pipe(
      startWith(this.filtros.controls.q.value), map(value => value.trim()), debounceTime(250), distinctUntilChanged(),
      switchMap(value => {
        if (value.length < 2) { this.busquedaRelacionada.set(null); this.buscandoRelacionado.set(false); return of(null); }
        this.buscandoRelacionado.set(true);
        return this.crm.buscarGlobal(value).pipe(
          catchError(() => of({ productos: [], clientes: [], unidades: [] })),
          finalize(() => this.buscandoRelacionado.set(false)),
        );
      }), takeUntilDestroyed(this.destroyRef),
    ).subscribe(result => this.busquedaRelacionada.set(result));
    this.filtrosPerdidas.valueChanges.pipe(debounceTime(250), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => { this.pagePerdidas = 0; this.refreshPerdidas.next(); });
    this.cargarResumen();
  }
  cargar() { this.refresh.next(); this.refreshPerdidas.next(); this.cargarResumen(); }
  cargarResumen() {
    this.crm.getResumen().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => this.resumen.set(result), error: () => this.resumen.set(null),
    });
  }
  paginar(event: PageEvent) { this.page = event.pageIndex; this.pageSize = event.pageSize; this.refresh.next(); }
  paginarPerdidas(event: PageEvent) { this.pagePerdidas = event.pageIndex; this.pageSizePerdidas = event.pageSize; this.refreshPerdidas.next(); }
  editar(item?: Oportunidad) {
    this.dialog.open(CrmOportunidadDialogComponent, { width: '860px', maxWidth: '96vw', data: item || null, disableClose: true })
      .afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(changed => { if (changed) this.cargar(); });
  }
  crearParaCliente(cliente: GlobalSearchItem) {
    const data: CrmOportunidadPrefill = { idCliente: cliente.id, empresa: cliente.titulo, email: cliente.subtitulo || '' };
    this.dialog.open(CrmOportunidadDialogComponent, { width: '860px', maxWidth: '96vw', data, disableClose: true })
      .afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(changed => { if (changed) this.cargar(); });
  }
  abrirProducto(producto: GlobalSearchItem) {
    this.router.navigate(['/producto'], { queryParams: { q: producto.codigo || producto.titulo } });
  }
  registrarPerdida(item?: Oportunidad) {
    this.dialog.open(CrmVentaPerdidaDialogComponent, { width: '600px', maxWidth: '96vw', data: item || null, disableClose: true })
      .afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(changed => {
        if (changed) { this.cargar(); this.snack.open('Demanda no atendida registrada', 'Cerrar', { duration: 3000 }); }
      });
  }
  vencida(item: Oportunidad) {
    return !['Ganada', 'Perdida'].includes(item.etapa) && !!item.fechaSiguienteAccion && new Date(item.fechaSiguienteAccion).getTime() < Date.now();
  }
  porEtapa(etapa: string) { return this.oportunidades().filter(item => item.etapa === etapa); }
}
