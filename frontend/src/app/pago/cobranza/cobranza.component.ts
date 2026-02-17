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
  // Cliente
  clienteControl = new FormControl<string | Cliente>('');
  clientesFiltrados$: Observable<Cliente[]> = of([]);
  listaClientes: Cliente[] = [];
  clienteSeleccionado: Cliente | null = null;

  // Facturas Pendientes
  facturasPendientes: any[] = [];
  displayedColumns: string[] = ['folio', 'fecha', 'total', 'saldo', 'abono'];

  // Formulario de Abono
  montoAbono = 0;
  formaPago = 'Efectivo';
  referencia = '';
  facturaSeleccionada: any = null;

  constructor(
    // 2. INYECCIÓN EXPLÍCITA (Esto soluciona el error "No suitable injection token")
    @Inject(ClienteService) private clienteService: ClienteService,
    @Inject(PagoService) private pagoService: PagoService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.cargarClientes();
  }

  cargarClientes() {
    this.clienteService.getClientes().subscribe(data => {
      this.listaClientes = data;
      
      this.clientesFiltrados$ = this.clienteControl.valueChanges.pipe(
        startWith(''),
        map(val => {
           const term = typeof val === 'string' ? val : (val as Cliente)?.razonSocial || '';
           return term ? this._filter(term) : this.listaClientes.slice();
        })
      );
    });
  }

  _filter(val: string): Cliente[] {
    const v = val.toLowerCase();
    return this.listaClientes.filter(c => (c.razonSocial || '').toLowerCase().includes(v));
  }

  displayCli(c: Cliente) { return c ? c.razonSocial : ''; }

  seleccionarCliente(c: Cliente) {
    this.clienteSeleccionado = c;
    this.cargarPendientes();
  }

  cargarPendientes() {
    if (!this.clienteSeleccionado) return;
    this.pagoService.getPendientes(this.clienteSeleccionado.idCliente).subscribe(res => {
      this.facturasPendientes = res;
    });
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
      next: () => {
        this.snackBar.open('Pago registrado con éxito', 'Ok', { duration: 3000 });
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