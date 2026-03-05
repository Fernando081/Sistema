// frontend/src/app/pago/cuentas-por-pagar/cuentas-por-pagar.component.ts
import { Component, OnInit, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';

// Material
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

// Servicios e Interfaces
import { ProveedorService } from '../../services/proveedor.service';
import { PagoProveedorService, PagoProveedorDto } from '../../services/pago-proveedor.service';
import { Proveedor } from '../../proveedor/proveedor.interface'; // Asegúrate de tener esta interfaz
import { Observable, of } from 'rxjs';
import { map, startWith } from 'rxjs/operators';
import { ChangeDetectorRef } from '@angular/core';

@Component({
  selector: 'app-cuentas-por-pagar',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, FormsModule,
    MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule,
    MatIconModule, MatTableModule, MatAutocompleteModule, MatSelectModule, MatSnackBarModule
  ],
  templateUrl: './cuentas-por-pagar.component.html',
})
export class CuentasPorPagarComponent implements OnInit {
  // Buscador
  filtroControl = new FormControl<string>('');

  // Tabla de Deudas
  deudasOriginales: any[] = [];
  deudasPendientes: any[] = [];
  displayedColumns: string[] = ['folio', 'proveedor', 'fecha', 'total', 'saldo', 'pagar'];

  // Formulario de Pago
  compraSeleccionada: any = null;
  montoPagar = 0;
  formaPago = 'Transferencia';
  referencia = '';

  constructor(
    @Inject(ProveedorService) private proveedorService: ProveedorService,
    @Inject(PagoProveedorService) private pagoService: PagoProveedorService,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.cargarDeudas();
    this.filtroControl.valueChanges.subscribe(val => {
      this.aplicarFiltro(val || '');
    });
  }

  cargarDeudas() {
    this.pagoService.getAllDeuda().subscribe({
      next: (res) => {
        this.deudasOriginales = (res as any).data || res;
        this.aplicarFiltro(this.filtroControl.value || '');
        this.cdr.detectChanges();
      },
      error: (e) => console.error(e)
    });
  }

  aplicarFiltro(term: string) {
    const v = term.toLowerCase();
    this.deudasPendientes = this.deudasOriginales.filter(d => 
       (d.proveedor_nombre || '').toLowerCase().includes(v) ||
       (d.folio_factura_proveedor || '').toLowerCase().includes(v)
    );
  }

  seleccionarCompra(compra: any) {
    this.compraSeleccionada = compra;
    this.montoPagar = Number(compra.saldo_pendiente); // Sugerir liquidar
  }

  registrarPago() {
    if (!this.compraSeleccionada || this.montoPagar <= 0) return;

    const dto: PagoProveedorDto = {
      idCompra: this.compraSeleccionada.id_compra,
      monto: Number(this.montoPagar), // Importante: Asegurar que sea número
      formaPago: this.formaPago,
      referencia: this.referencia || ''
    };

    this.pagoService.registrar(dto).subscribe({
      next: () => {
        this.snackBar.open('Pago a proveedor registrado exitosamente', 'Cerrar', { duration: 3000 });
        this.compraSeleccionada = null;
        this.montoPagar = 0;
        this.cargarDeudas(); // Refrescar lista
      },
      error: (e) => {
        console.error(e);
        this.snackBar.open('Error: ' + (e.error?.message || e.message), 'Cerrar');
      }
    });
  }
}