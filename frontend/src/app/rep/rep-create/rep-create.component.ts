import { Cliente } from '../../cliente/cliente.interface';
import { FacturaPendiente, RepHistorial } from '../../services/pago-api.types';
import { HttpErrorResponse } from '@angular/common/http';
import { MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { FiscalCancellation } from '../../services/fiscal.service';
interface FacturaRepEditable extends Omit<FacturaPendiente, 'total' | 'saldo_pendiente'> { total: number; saldo_pendiente: number; montoSaldado: number; }
// frontend/src/app/rep/rep-create/rep-create.component.ts
import { Component, OnInit, ChangeDetectorRef, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { downloadDocument, localDate, roundMoney } from '../../shared/document-download';
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
import { Observable, Subscription } from 'rxjs';
import { map, startWith } from 'rxjs/operators';
import { FiscalConfiguration, FiscalService } from '../../services/fiscal.service';
import { FiscalCancelDialogComponent } from '../../shared/fiscal-cancel-dialog.component';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';

@Component({
  selector: 'app-rep-create',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, FormsModule,
    MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule,
    MatIconModule, MatTableModule, MatAutocompleteModule, MatSelectModule, MatSnackBarModule, MatTooltipModule,
    MatDialogModule,
  ],
  templateUrl: './rep-create.component.html'
})
export class RepCreateComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private pendingRequest?: Subscription;
  // Cliente Control AutoComplete
  clienteControl = new FormControl<string | Cliente>('', { nonNullable: true });
  clientesOriginales: Cliente[] = [];
  clientesFiltrados!: Observable<Cliente[]>;
  clienteSeleccionado: Cliente | null = null;

  // Facturas PPD Data
  facturasPendientes: FacturaRepEditable[] = [];
  displayedColumns: string[] = ['folio', 'total', 'saldo', 'abono', 'insoluto'];
  
  // Forma principal CFDI REP
  repForm: FormGroup<{ fechaPago: FormControl<string>; formaPago: FormControl<string>; moneda: FormControl<string>; cuentaBeneficiario: FormControl<string>; rfcBeneficiario: FormControl<string> }>;
  totalRep: number = 0;
  isSaving: boolean = false;
  private repAttempt?: { signature: string; requestId: string };
  repPendingConfirmation = false;

  // Historial Data
  historialReps: RepHistorial[] = [];
  displayedColumnsHistorico: string[] = ['id_rep', 'fecha_pago', 'cliente', 'estado', 'fiscal', 'total', 'acciones'];
  fiscalConfiguration?: FiscalConfiguration;
  fiscalOperationId?: number;

  constructor(
    private fb: FormBuilder,
    private clienteService: ClienteService,
    private pagoService: PagoService,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
    private fiscalService: FiscalService,
    private dialog: MatDialog,
  ) {
    this.repForm = this.fb.nonNullable.group({
      fechaPago: [localDate(), Validators.required],
      formaPago: ['Transferencia', Validators.required],
      moneda: ['MXN', Validators.required],
      cuentaBeneficiario: [''],
      rfcBeneficiario: ['']
    });
  }

  ngOnInit(): void {
    this.cargarClientes();
    this.cargarHistorial();
    this.fiscalService.configuration().subscribe({
      next: config => { this.fiscalConfiguration = config; this.cdr.detectChanges(); },
    });
    this.clienteControl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(value => {
      if (typeof value === 'string' || !value) {
        this.pendingRequest?.unsubscribe();
        this.clienteSeleccionado = null;
        this.facturasPendientes = [];
        this.totalRep = 0;
      }
    });
    this.destroyRef.onDestroy(() => this.pendingRequest?.unsubscribe());
  }

  cargarHistorial() {
    this.pagoService.getHistorialReps().subscribe({
      next: (res) => {
        this.historialReps = res || [];
        this.cdr.detectChanges();
      },
      error: (e: unknown) => console.error('Error cargando historial:', e)
    });
  }

  cargarClientes() {
    this.clienteService.getClientes().subscribe({
      next: (res) => {
        this.clientesOriginales = res;
        this.clientesFiltrados = this.clienteControl.valueChanges.pipe(
          startWith(''),
          map(value => {
            const name = typeof value === 'string' ? value : value?.razonSocial;
            return name ? this._filterClientes(name) : this.clientesOriginales.slice();
          })
        );
      },
      error: (e: unknown) => console.error('Error cargando clientes:', e)
    });
  }

  private _filterClientes(name: string): Cliente[] {
    const filterValue = name.toLowerCase();
    return this.clientesOriginales.filter(c => 
      c.razonSocial?.toLowerCase().includes(filterValue) || 
      c.rfc?.toLowerCase().includes(filterValue)
    );
  }

  mostrarNombreCliente(cliente: Cliente | string | null): string {
    return typeof cliente === 'object' && cliente ? cliente.razonSocial : '';
  }

  onClienteSeleccionado(event: MatAutocompleteSelectedEvent) {
    const cliente: unknown = event.option.value;
    if (!cliente || typeof cliente !== 'object' || !('idCliente' in cliente)) return;
    const selected = this.clientesOriginales.find(item => item.idCliente === cliente.idCliente);
    if (!selected) return;
    this.clienteSeleccionado = selected;
    this.cargarFacturasPpd(selected.idCliente);
  }

  cargarFacturasPpd(idCliente: number) {
    this.pendingRequest?.unsubscribe();
    this.facturasPendientes = [];
    this.totalRep = 0;
    
    this.pendingRequest = this.pagoService.getPpdPendientes(idCliente).subscribe({
      next: (res) => {
        const facturas = res;
        this.facturasPendientes = facturas.map((f) => ({
          ...f,
          total: Number(f.total), saldo_pendiente: Number(f.saldo_pendiente),
          montoSaldado: 0 // Iniciar abono en cero
        }));
        this.cdr.detectChanges();
      },
      error: (e: unknown) => this.snackBar.open('Error al cargar facturas PPD', 'Ok', {duration: 3000})
    });
  }

  validarMontoSaldado(f: FacturaRepEditable) {
    const abono = Number(f.montoSaldado) || 0;
    const maximo = Number(f.saldo_pendiente) || 0;

    if (!Number.isFinite(abono) || abono < 0) {
      f.montoSaldado = 0;
    } else if (abono > maximo) {
      f.montoSaldado = maximo;
    }
    
    this.recalcularTotal();
  }

  recalcularTotal() {
    this.totalRep = this.facturasPendientes.reduce((sum, f) => {
      const abono = Number(f.montoSaldado) || 0;
      return roundMoney(sum + roundMoney(abono));
    }, 0);
  }

  generarRep() {
    if (this.isSaving) return;
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

    const val = this.repForm.getRawValue();
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

    const signature=JSON.stringify({...dto,facturas:[...dto.facturas].sort((a,b)=>a.idFactura-b.idFactura)});
    if(this.repAttempt&&this.repAttempt.signature!==signature){
      this.snackBar.open('Hay un REP pendiente de confirmar. Reintenta con los mismos datos o consulta el historial antes de registrar otro.', 'Cerrar', {duration:8000});
      return;
    }
    this.repAttempt??={signature,requestId:crypto.randomUUID()};
    dto.requestId=this.repAttempt.requestId;
    this.isSaving = true;
    this.pagoService.registrarRep(dto).subscribe({
      next: (res) => {
        this.isSaving = false;
        this.repAttempt=undefined;
        this.repPendingConfirmation=false;
        const snackRef = this.snackBar.open('REP Registrado exitosamente', 'Ver Recibo PDF', { duration: 8000 });
        
        snackRef.onAction().subscribe(() => {
          if (res && res.idRep) {
            this.pagoService.descargarRepPdf(res.idRep).subscribe({
              next: (blob: Blob) => {
                downloadDocument(blob, `REP_${res.idRep}.pdf`);
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
          fechaPago: localDate(),
          formaPago: 'Transferencia',
          moneda: 'MXN'
        });
        
        // Recargar el historial
        this.cargarHistorial();
      },
      error: (e: unknown) => {
        this.isSaving = false;
        const definitive=e instanceof HttpErrorResponse&&e.status>=400&&e.status<500&&![408,409,429].includes(e.status);
        if(definitive)this.repAttempt=undefined;
        this.repPendingConfirmation=!definitive;
        this.snackBar.open('Error al generar REP: ' + this.errorMessage(e), 'Cerrar');
      }
    });
  }

  descargarPdf(idRep: number) {
    this.pagoService.descargarRepPdf(idRep).subscribe({
      next: (blob: Blob) => {
        downloadDocument(blob, `REP_${idRep}.pdf`);
      },
      error: (err) => this.snackBar.open('Error al descargar el PDF', 'Ok', {duration: 3000})
    });
  }

  descargarXml(rep: RepHistorial) {
    const request = rep.tiene_xml_fiscal
      ? this.fiscalService.xml('reps', rep.id_rep)
      : this.pagoService.descargarRepXml(rep.id_rep);
    request.subscribe({
      next: (blob: Blob) => {
        downloadDocument(blob, rep.tiene_xml_fiscal ? `REP_${rep.id_rep}.xml` : `REP_${rep.id_rep}_borrador.xml`);
      },
      error: (err) => this.snackBar.open('Error al descargar el XML', 'Ok', {duration: 3000})
    });
  }

  cancelarRep(idRep: number) {
    this.dialog.open<FiscalCancelDialogComponent, { label: string }, FiscalCancellation>(FiscalCancelDialogComponent, { width: '560px', data: { label: `REP-${idRep}` } }).afterClosed().subscribe(fiscal => {
      if (!fiscal) return;
      this.fiscalOperationId = idRep;
      this.pagoService.cancelarRep(idRep, fiscal).subscribe({
        next: (response) => {
        this.fiscalOperationId = undefined;
        this.snackBar.open(response.message || 'Solicitud procesada', 'Cerrar', {duration: 6000});
        this.cargarHistorial();
        // Recargar facturas si un cliente está seleccionado
        if (this.clienteSeleccionado) {
           this.cargarFacturasPpd(this.clienteSeleccionado.idCliente);
        }
      },
        error: (error: unknown) => {
          this.fiscalOperationId = undefined;
          this.snackBar.open(this.errorMessage(error, 'Error al cancelar REP'), 'Cerrar', {duration: 5000});
        },
      });
    });
  }

  timbrarRep(idRep: number) {
    if (this.fiscalOperationId) return;
    this.fiscalOperationId = idRep;
    this.fiscalService.stamp('reps', idRep).subscribe({
      next: document => {
        this.fiscalOperationId = undefined;
        this.snackBar.open(document.estado === 'Timbrado' ? 'REP timbrado correctamente' : `Estado fiscal: ${document.estado}`, 'Cerrar', { duration: 5000 });
        this.cargarHistorial();
      },
      error: error => {
        this.fiscalOperationId = undefined;
        this.snackBar.open(error.error?.message || 'No fue posible timbrar el REP', 'Cerrar', { duration: 7000 });
        this.cargarHistorial();
      },
    });
  }

  descargarAcuse(rep: RepHistorial) {
    this.fiscalService.acknowledgement('reps', rep.id_rep).subscribe({
      next: blob => downloadDocument(blob, `ACUSE_REP_${rep.id_rep}.xml`),
      error: error => this.snackBar.open(error.error?.message || 'Acuse no disponible', 'Cerrar', { duration: 4000 }),
    });
  }
  private errorMessage(error: unknown, fallback = 'No fue posible procesar la solicitud'): string {
    if (error instanceof HttpErrorResponse) {
      const body: unknown = error.error;
      if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') return body.message;
      return error.message || fallback;
    }
    return error instanceof Error ? error.message : fallback;
  }
}
