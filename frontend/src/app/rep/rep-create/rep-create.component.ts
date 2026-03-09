// frontend/src/app/rep/rep-create/rep-create.component.ts
import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators, FormControl } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ClienteService } from '../../services/cliente.service';
import { PagoService, RegistrarRepDto, RepFacturaDto } from '../../services/pago.service';
import { Observable } from 'rxjs';
import { map, startWith } from 'rxjs/operators';

@Component({
  selector: 'app-rep-create',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, FormsModule,
    MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule,
    MatIconModule, MatTableModule, MatAutocompleteModule, MatSelectModule, MatSnackBarModule, MatTooltipModule
  ],
  templateUrl: './rep-create.component.html'
})
export class RepCreateComponent implements OnInit {
  // Cliente Control AutoComplete
  clienteControl = new FormControl('');
  clientesOriginales: any[] = [];
  clientesFiltrados!: Observable<any[]>;
  clienteSeleccionado: any = null;

  // Facturas PPD Data
  facturasPendientes: any[] = [];
  displayedColumns: string[] = ['folio', 'total', 'saldo', 'abono', 'insoluto'];
  
  // Forma principal CFDI REP
  repForm: FormGroup;
  totalRep: number = 0;
  isSaving: boolean = false;

  // Historial Data
  historialReps: any[] = [];
  displayedColumnsHistorico: string[] = ['id_rep', 'fecha_pago', 'cliente', 'estado', 'total', 'acciones'];

  constructor(
    private fb: FormBuilder,
    private clienteService: ClienteService,
    private pagoService: PagoService,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef
  ) {
    this.repForm = this.fb.group({
      fechaPago: [new Date().toISOString().split('T')[0], Validators.required],
      formaPago: ['Transferencia', Validators.required],
      moneda: ['MXN', Validators.required],
      cuentaBeneficiario: [''],
      rfcBeneficiario: ['']
    });
  }

  ngOnInit(): void {
    this.cargarClientes();
    this.cargarHistorial();
  }

  cargarHistorial() {
    this.pagoService.getHistorialReps().subscribe({
      next: (res: any) => {
        this.historialReps = res || [];
        this.cdr.detectChanges();
      },
      error: (e: any) => console.error('Error cargando historial:', e)
    });
  }

  cargarClientes() {
    this.clienteService.getClientes().subscribe({
      next: (res: any) => {
        this.clientesOriginales = res.data || res;
        this.clientesFiltrados = this.clienteControl.valueChanges.pipe(
          startWith(''),
          map(value => {
            const name = typeof value === 'string' ? value : (value as any)?.razonSocial;
            return name ? this._filterClientes(name) : this.clientesOriginales.slice();
          })
        );
      },
      error: (e: any) => console.error('Error cargando clientes:', e)
    });
  }

  private _filterClientes(name: string): any[] {
    const filterValue = name.toLowerCase();
    return this.clientesOriginales.filter(c => 
      c.razonSocial?.toLowerCase().includes(filterValue) || 
      c.rfc?.toLowerCase().includes(filterValue)
    );
  }

  mostrarNombreCliente(cliente: any): string {
    return cliente && cliente.razonSocial ? cliente.razonSocial : '';
  }

  onClienteSeleccionado(event: any) {
    this.clienteSeleccionado = event.option.value;
    this.cargarFacturasPpd(this.clienteSeleccionado.idCliente);
  }

  cargarFacturasPpd(idCliente: number) {
    this.facturasPendientes = [];
    this.totalRep = 0;
    
    this.pagoService.getPpdPendientes(idCliente).subscribe({
      next: (res: any) => {
        const facturas = res.data || res;
        this.facturasPendientes = facturas.map((f: any) => ({
          ...f,
          montoSaldado: 0 // Iniciar abono en cero
        }));
        this.cdr.detectChanges();
      },
      error: (e: any) => this.snackBar.open('Error al cargar facturas PPD', 'Ok', {duration: 3000})
    });
  }

  validarMontoSaldado(f: any) {
    const abono = Number(f.montoSaldado) || 0;
    const maximo = Number(f.saldo_pendiente) || 0;

    if (abono < 0) {
      f.montoSaldado = 0;
    } else if (abono > maximo) {
      f.montoSaldado = maximo;
    }
    
    this.recalcularTotal();
  }

  recalcularTotal() {
    this.totalRep = this.facturasPendientes.reduce((sum, f) => {
      const abono = Number(f.montoSaldado) || 0;
      return sum + abono;
    }, 0);
  }

  generarRep() {
    if (!this.clienteSeleccionado) return;
    if (this.totalRep <= 0 || !this.repForm.valid) return;

    // Recolectar facturas con abonos > 0
    const facturasAAbonar: RepFacturaDto[] = this.facturasPendientes
      .filter(f => (Number(f.montoSaldado) || 0) > 0)
      .map(f => ({
        idFactura: f.id_factura,
        montoSaldado: Number(f.montoSaldado)
      }));

    if (facturasAAbonar.length === 0) {
       this.snackBar.open('Debes asignar un monto a abonar al menos a una factura', 'Ok', {duration: 3000});
       return;
    }

    const val = this.repForm.value;
    const dto: RegistrarRepDto = {
      idCliente: this.clienteSeleccionado.idCliente,
      fechaPago: val.fechaPago,
      formaPago: val.formaPago,
      moneda: val.moneda,
      montoTotal: this.totalRep,
      cuentaBeneficiario: val.cuentaBeneficiario,
      rfcBeneficiario: val.rfcBeneficiario,
      facturas: facturasAAbonar
    };

    this.isSaving = true;
    this.pagoService.registrarRep(dto).subscribe({
      next: (res: any) => {
        this.isSaving = false;
        const snackRef = this.snackBar.open('REP Registrado exitosamente', 'Ver Recibo PDF', { duration: 8000 });
        
        snackRef.onAction().subscribe(() => {
          if (res && res.idRep) {
            this.pagoService.descargarRepPdf(res.idRep).subscribe({
              next: (blob: Blob) => {
                const url = window.URL.createObjectURL(blob);
                window.open(url);
              },
              error: (err) => console.error('Error al descargar el PDF del REP:', err)
            });
          }
        });

        // Reset
        this.clienteControl.setValue('');
        this.clienteSeleccionado = null;
        this.facturasPendientes = [];
        this.totalRep = 0;
        this.repForm.reset({
          fechaPago: new Date().toISOString().split('T')[0],
          formaPago: 'Transferencia',
          moneda: 'MXN'
        });
        
        // Recargar el historial
        this.cargarHistorial();
      },
      error: (e: any) => {
        this.isSaving = false;
        this.snackBar.open('Error al generar REP: ' + (e.error?.message || e.message), 'Cerrar');
      }
    });
  }

  descargarPdf(idRep: number) {
    this.pagoService.descargarRepPdf(idRep).subscribe({
      next: (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        window.open(url);
      },
      error: (err) => this.snackBar.open('Error al descargar el PDF', 'Ok', {duration: 3000})
    });
  }

  descargarXml(idRep: number) {
    this.pagoService.descargarRepXml(idRep).subscribe({
      next: (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `REP_${idRep}_pretimbrado.xml`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      },
      error: (err) => this.snackBar.open('Error al descargar el XML', 'Ok', {duration: 3000})
    });
  }

  cancelarRep(idRep: number) {
    if (!confirm(`¿Estás seguro de que deseas CANCELAR el REP-${idRep}? El dinero pagado regresará a las facturas correspondientes como saldo pendiente.`)) {
      return;
    }
    
    this.pagoService.cancelarRep(idRep).subscribe({
      next: () => {
        this.snackBar.open('REP Cancelado Exitosamente', 'Cerrar', {duration: 4000});
        this.cargarHistorial();
        // Recargar facturas si un cliente está seleccionado
        if (this.clienteSeleccionado) {
           this.cargarFacturasPpd(this.clienteSeleccionado.idCliente);
        }
      },
      error: (err) => this.snackBar.open('Error al cancelar REP', 'Cerrar', {duration: 3000})
    });
  }
}
