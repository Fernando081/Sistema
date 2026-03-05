import { Component, signal, inject, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FinanzasService, Gasto } from '../finanzas.service';
import { environment } from '../../../environments/environment';
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

  gastosList = signal<any[]>([]);
  saldos = signal<any[]>([]);
  displayedColumnsGastos = ['fecha', 'concepto', 'categoria', 'metodoPago', 'monto'];

  ngOnInit() {
    this.cargarDatos();
  }

  cargarDatos() {
    this.finanzasService.getGastos().subscribe(res => this.gastosList.set(res));
    this.finanzasService.getSaldos().subscribe(res => this.saldos.set(res));
  }

  onSubmit() {
    if (!this.concepto() || !this.monto() || !this.categoria() || !this.metodoPago()) {
      this.errorMessage.set('Por favor completa todos los campos requeridos.');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    const payload: Gasto = {
      concepto: this.concepto(),
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
    const pdfUrl = `${environment.apiBaseUrl}/finanzas/corte-pdf`;

    // Check if auth token is needed for the download
    const token = localStorage.getItem('access_token');

    // The preferred way for protected downloads in browser is fetching as blob or using an auth proxy.
    // Assuming we can pass token or using fetch to get Blob.
    fetch(pdfUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then((response) => {
        if (!response.ok) throw new Error('Error validando autorización para PDF');
        return response.blob();
      })
      .then((blob) => {
        const url = window.URL.createObjectURL(blob);
        window.open(url, '_blank');
        // Revoking after opening usually works, but a slight timeout ensures it's read by the new tab
        setTimeout(() => window.URL.revokeObjectURL(url), 1000);
      })
      .catch((err) => {
        console.error(err);
        this.errorMessage.set('No se pudo descargar el reporte PDF.');
      });
  }
}
