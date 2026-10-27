import { Component, signal, inject, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FinanzasService, Gasto, GastoRegistro, SaldoActual } from '../finanzas.service';
import { downloadDocument, localDate } from '../../shared/document-download';
import { MatTableModule } from '@angular/material/table';

@Component({
  selector: 'app-gastos',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTableModule],
  templateUrl: './gastos.component.html',
})
export class GastosComponent implements OnInit {
  private finanzasService = inject(FinanzasService);

  // Signals for form
  concepto = signal('');
  monto = signal<number | null>(null);
  categoria = signal('Operativos');
  metodoPago = signal('Transferencia');
  idCompra = signal<number | null>(null);

  // Computed signal to track if we show id_compra field
  isLogistics = computed(() => this.categoria() === 'Flete/Paquetería');

  loading = signal(false);
  successMessage = signal('');
  errorMessage = signal('');

  // Dropdown options
  categorias = [
    'Operativos',
    'Nómina',
    'Stock',
    'Flete/Paquetería',
    'Impuestos',
    'Marketing',
    'Otros',
  ];
  metodos = ['Transferencia', 'Efectivo', 'Tarjeta de Débito', 'Tarjeta de Crédito'];

  gastosList = signal<GastoRegistro[]>([]);
  saldos = signal<SaldoActual[]>([]);
  displayedColumnsGastos = ['fecha', 'concepto', 'categoria', 'metodoPago', 'monto'];

  ngOnInit() {
    this.cargarDatos();
  }

  cargarDatos() {
    this.finanzasService.getGastos().subscribe(res => this.gastosList.set(res));
    this.finanzasService.getSaldos().subscribe(res => this.saldos.set(res));
  }

  onSubmit() {
    if (this.loading()) return;
    if (!this.concepto().trim() || !Number.isFinite(this.monto()) || Number(this.monto()) <= 0 || !this.categoria() || !this.metodoPago()) {
      this.errorMessage.set('Por favor completa todos los campos requeridos.');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    const payload: Gasto = {
      concepto: this.concepto().trim(),
      monto: this.monto()!,
      categoria: this.categoria(),
      metodoPago: this.metodoPago(),
    };

    if (this.isLogistics() && this.idCompra()) {
      payload.idCompra = this.idCompra()!;
    }

    this.finanzasService.crearGasto(payload).subscribe({
      next: () => {
        this.successMessage.set('Gasto registrado exitosamente.');
        this.resetForm();
        this.cargarDatos(); // Refresh list after submitting
        this.loading.set(false);
      },
      error: (err) => {
        console.error(err);
        this.errorMessage.set('Ocurrió un error al registrar el gasto.');
        this.loading.set(false);
      },
    });
  }

  resetForm() {
    this.concepto.set('');
    this.monto.set(null);
    this.categoria.set('Operativos');
    this.metodoPago.set('Transferencia');
    this.idCompra.set(null);
  }

  downloadPDF() {
    this.finanzasService.getCortePdf().subscribe({
      next: blob => downloadDocument(blob, `Corte_${localDate()}.pdf`),
      error: () => this.errorMessage.set('No se pudo descargar el reporte PDF.'),
    });
  }
}
