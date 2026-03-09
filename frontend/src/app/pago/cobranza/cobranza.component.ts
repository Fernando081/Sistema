// frontend/src/app/pago/cobranza.component.ts
import { Component, OnInit, Inject } from '@angular/core'; // <--- 1. AGREGAR Inject AQUÍ
import { CommonModule } from '@angular/common';
import { FormControl, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
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

// Servicios
import { ClienteService } from '../../services/cliente.service';
import { PagoService, PagoDto } from '../../services/pago.service';
import { Cliente } from '../../cliente/cliente.interface';
import { Observable, of } from 'rxjs';
import { map, startWith } from 'rxjs/operators';
import { ChangeDetectorRef } from '@angular/core';

@Component({
  selector: 'app-cobranza',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, FormsModule,
    MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule,
    MatIconModule, MatTableModule, MatAutocompleteModule, MatSelectModule, MatSnackBarModule
  ],
  templateUrl: './cobranza.component.html',
})
export class CobranzaComponent implements OnInit {
  // Filtro
  filtroControl = new FormControl<string>('');

  // Facturas Pendientes
  facturasOriginales: any[] = [];
  facturasPendientes: any[] = [];
  displayedColumns: string[] = ['folio', 'cliente', 'fecha', 'total', 'saldo', 'abono'];

  // Formulario de Abono
  montoAbono = 0;
  formaPago = 'Efectivo';
  referencia = '';
  facturaSeleccionada: any = null;

  constructor(
    // 2. INYECCIÓN EXPLÍCITA (Esto soluciona el error "No suitable injection token")
    @Inject(ClienteService) private clienteService: ClienteService,
    @Inject(PagoService) private pagoService: PagoService,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.cargarPendientes();
    this.filtroControl.valueChanges.subscribe(val => {
      this.aplicarFiltro(val || '');
    });
  }

  cargarPendientes() {
    this.pagoService.getAllPendientes().subscribe({
      next: (res) => {
        this.facturasOriginales = (res as any).data || res;
        this.aplicarFiltro(this.filtroControl.value || '');
        this.cdr.detectChanges();
      },
      error: (e) => console.error(e)
    });
  }

  aplicarFiltro(term: string) {
    const v = term.toLowerCase();
    this.facturasPendientes = this.facturasOriginales.filter(f => 
       (f.cliente_nombre || '').toLowerCase().includes(v) ||
       (f.folio || '').toLowerCase().includes(v) ||
       (f.serie || '').toLowerCase().includes(v)
    );
  }

  seleccionarFactura(factura: any) {
    this.facturaSeleccionada = factura;
    this.montoAbono = Number(factura.saldo_pendiente); // Sugerir liquidar
  }

  registrarPago() {
    if (!this.facturaSeleccionada || this.montoAbono <= 0) return;

    const dto: PagoDto = {
      idFactura: this.facturaSeleccionada.id_factura,
      
      // --- CORRECCIÓN: Forzar conversión a Número ---
      monto: Number(this.montoAbono), 
      
      formaPago: this.formaPago,
      referencia: this.referencia || '' // Evitar null
    };

    this.pagoService.registrar(dto).subscribe({
      next: (res: any) => {
        const snackRef = this.snackBar.open('Pago registrado con éxito', 'Ver Recibo (REP)', { duration: 6000 });
        
        snackRef.onAction().subscribe(() => {
          if (res && res.idPago) {
            this.pagoService.descargarRepPdf(res.idPago).subscribe({
              next: (blob: Blob) => {
                const url = window.URL.createObjectURL(blob);
                window.open(url);
              },
              error: (err) => {
                console.error('Error al descargar el PDF del REP:', err);
                this.snackBar.open('No se pudo descargar el recibo', 'Ok', { duration: 3000 });
              }
            });
          }
        });

        this.facturaSeleccionada = null;
        this.montoAbono = 0;
        this.cargarPendientes();
      },
      error: (e) => {
         console.error(e); // Para ver el error real en consola
         this.snackBar.open('Error: ' + (e.error?.message || e.message), 'Ok');
      }
    });
  }
}