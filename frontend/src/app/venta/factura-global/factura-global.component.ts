// frontend/src/app/venta/factura-global/factura-global.component.ts
import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { SelectionModel } from '@angular/cdk/collections';
import anime from 'animejs';

// Material Imports
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule, provideNativeDateAdapter } from '@angular/material/core';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';

// Services
import { VentaService } from '../../services/venta.service';

export interface PendingTicket {
  idFactura: number;
  serie: string;
  folio: number;
  fechaEmision: string;
  rfcReceptor: string;
  nombreReceptor: string;
  subtotal: number;
  totalImpuestosTrasladados: number;
  totalImpuestosRetenidos: number;
  total: number;
}

@Component({
  selector: 'app-factura-global',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatCheckboxModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatDividerModule
  ],
  providers: [provideNativeDateAdapter()],
  templateUrl: './factura-global.component.html',
})
export class FacturaGlobalComponent implements OnInit {
  dateForm: FormGroup;
  dataSource = new MatTableDataSource<PendingTicket>([]);
  selection = new SelectionModel<PendingTicket>(true, []);
  
  // State variables
  isLoading = signal(false);
  isSaving = signal(false);
  searchDone = signal(false);

  // Table columns
  displayedColumns: string[] = [
    'select',
    'folio',
    'fecha',
    'cliente',
    'rfc',
    'subtotal',
    'iva',
    'total'
  ];

  // Computed totals for selected tickets
  selectedSubtotal = computed(() => {
    return this.selection.selected.reduce((acc, t) => acc + Number(t.subtotal || 0), 0);
  });
  
  selectedIva = computed(() => {
    return this.selection.selected.reduce((acc, t) => acc + Number(t.totalImpuestosTrasladados || 0), 0);
  });

  selectedTotal = computed(() => {
    return this.selection.selected.reduce((acc, t) => acc + Number(t.total || 0), 0);
  });

  constructor(
    private fb: FormBuilder,
    private ventaService: VentaService,
    private snackBar: MatSnackBar
  ) {
    // Inicializar fechas: por defecto el último mes
    const hoy = new Date();
    const haceUnMes = new Date();
    haceUnMes.setMonth(hoy.getMonth() - 1);

    this.dateForm = this.fb.group({
      fechaInicio: [haceUnMes, Validators.required],
      fechaFin: [hoy, Validators.required]
    });
  }

  ngOnInit(): void {
    this.buscarTickets();
  }

  buscarTickets() {
    if (this.dateForm.invalid) return;

    this.isLoading.set(true);
    this.searchDone.set(false);
    this.selection.clear();

    const { fechaInicio, fechaFin } = this.dateForm.value;
    const iniStr = this.formatDate(fechaInicio);
    const finStr = this.formatDate(fechaFin);

    this.ventaService.getTicketsPendientesGlobal(iniStr, finStr).subscribe({
      next: (res) => {
        this.dataSource.data = res.tickets || [];
        this.isLoading.set(false);
        this.searchDone.set(true);
        // Seleccionar todo por defecto
        this.dataSource.data.forEach(row => this.selection.select(row));
        this.animateTotalsCard();
      },
      error: (err) => {
        this.isLoading.set(false);
        this.mostrarNotificacion('Error al buscar tickets pendientes: ' + (err.error?.message || err.message));
      }
    });
  }

  generarFacturaGlobal() {
    if (this.selection.selected.length === 0) {
      this.mostrarNotificacion('Debes seleccionar al menos un ticket para agrupar.');
      return;
    }

    this.isSaving.set(true);

    const { fechaInicio, fechaFin } = this.dateForm.value;
    const iniStr = this.formatDate(fechaInicio);
    const finStr = this.formatDate(fechaFin);
    const idsTickets = this.selection.selected.map(t => t.idFactura);

    this.ventaService.generarFacturaGlobal(iniStr, finStr, idsTickets).subscribe({
      next: (res) => {
        this.isSaving.set(false);
        this.mostrarNotificacion('¡Factura Global generada con éxito! Folio: ' + res.idFactura);
        this.buscarTickets();
      },
      error: (err) => {
        this.isSaving.set(false);
        this.mostrarNotificacion('Error al generar la Factura Global: ' + (err.error?.message || err.message));
      }
    });
  }

  /** Whether the number of selected elements matches the total number of rows. */
  isAllSelected() {
    const numSelected = this.selection.selected.length;
    const numRows = this.dataSource.data.length;
    return numSelected === numRows;
  }

  /** Selects all rows if they are not all selected; otherwise clear selection. */
  masterToggle() {
    if (this.isAllSelected()) {
      this.selection.clear();
    } else {
      this.dataSource.data.forEach(row => this.selection.select(row));
    }
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private mostrarNotificacion(msg: string) {
    this.snackBar.open(msg, 'Cerrar', { duration: 4000 });
  }

  private animateTotalsCard() {
    setTimeout(() => {
      anime({
        targets: '.totals-card-global',
        translateY: [20, 0],
        opacity: [0, 1],
        duration: 500,
        easing: 'easeOutQuart'
      });
    }, 50);
  }
}
