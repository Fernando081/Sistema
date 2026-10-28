// frontend/src/app/cotizacion/nueva-cotizacion/nueva-cotizacion.component.ts
import { Component, OnInit, signal, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { downloadDocument, roundMoney } from '../../shared/document-download';
import { CommonModule } from '@angular/common';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';

import { ProductoService } from '../../services/producto.service';
import { ClienteService } from '../../services/cliente.service';
import {
  CotizacionService,
  ConceptoCotizacion,
  CreateCotizacion,
} from '../../services/cotizacion.service';
import { Producto } from '../../producto/producto.interface';
import { Cliente } from '../../cliente/cliente.interface';
import { ActivatedRoute, Router } from '@angular/router';
import { CotizacionVersionService } from '../../services/cotizacion-version.service';
import { FinancialRequestIntent } from '../../shared/financial-request-intent';

import { Observable, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, finalize, map, startWith, switchMap } from 'rxjs/operators';

@Component({
  selector: 'app-nueva-cotizacion',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatAutocompleteModule,
    MatSnackBarModule,
    MatDividerModule,
  ],
  templateUrl: './nueva-cotizacion.component.html',
  styleUrl: './nueva-cotizacion.component.css',
})
export class NuevaCotizacionComponent implements OnInit {
  carrito: ConceptoCotizacion[] = [];
  clienteSeleccionado: Cliente | null = null;

  // Totales
  subtotalGeneral = 0;
  ivaGeneral = 0;
  retIsrGeneral = 0;
  totalGeneral = 0;
  isSaving = signal(false);
  revisionSource=Number(inject(ActivatedRoute).snapshot.queryParamMap.get('revisionDe'))||0;
  revisionId=0; revisionLoading=signal(false); revisionError=signal('');
  revisionMotive=new FormControl('',{nonNullable:true});
  private readonly versions=inject(CotizacionVersionService);private readonly router=inject(Router);private readonly revisionIntent=new FinancialRequestIntent();
  private readonly destroyRef = inject(DestroyRef);

  // Controles
  clienteControl = new FormControl<string | Cliente>('');
  productoControl = new FormControl<string | Producto>('');

  listaClientes: Cliente[] = [];
  clientesFiltrados$: Observable<Cliente[]> = of([]);
  productosFiltrados$: Observable<Producto[]> = of([]);

  displayedColumns: string[] = ['descripcion', 'cantidad', 'precio', 'importe', 'acciones'];

  constructor(
    private productoService: ProductoService,
    private clienteService: ClienteService,
    private cotizacionService: CotizacionService,
    private snackBar: MatSnackBar,
  ) {}

  ngOnInit(): void {
    this.cargarCatalogos();
    this.configurarAutocompletes();
    this.clienteControl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(value => {
      if (typeof value === 'string' || !value) { this.clienteSeleccionado = null; this.recalcularCarrito(); }
    });
  }

  cargarCatalogos() {
    // Cargar Clientes (Service now handles mapping)
    this.clienteService.getClientes().subscribe((data) => {
      this.listaClientes = data;
      this.clienteControl.updateValueAndValidity({ emitEvent: true });
      if(this.revisionSource)this.loadRevision();
    });

  }

  private loadRevision(){this.revisionLoading.set(true);this.versions.state(this.revisionSource).pipe(finalize(()=>this.revisionLoading.set(false)),takeUntilDestroyed(this.destroyRef)).subscribe({next:d=>{
    if(!d.gestion||!d.actual||d.actual.idCotizacion!==this.revisionSource){this.revisionError.set('Abre la última revisión con permiso para versionar.');return;}
    const client=this.listaClientes.find(c=>c.idCliente===d.snapshot.idCliente);if(!client){this.revisionError.set('El cliente ya no está disponible.');return;}
    this.revisionId=d.actual.idRevision;this.clienteSeleccionado=client;this.clienteControl.setValue(client);this.clienteControl.disable();
    this.carrito=d.snapshot.conceptos.map(c=>{const p=d.productos.find(p=>p.idProducto===c.idProducto);return{idProducto:c.idProducto,descripcion:c.descripcion,unidadDescripcion:c.unidad,cantidad:Number(c.cantidad),valorUnitario:Number(c.precio),importe:0,importeIva:0,importeRetIsr:0,objetoImpuesto:p?.objetoImpuesto,tasaIva:Number(p?.tasaIva??0),aplicaRetencionIsr:p?.aplicaRetencionIsr??false};});this.recalcularCarrito();
  },error:()=>this.revisionError.set('No se pudo cargar la revisión. Vuelve al historial y reintenta.')});}

  configurarAutocompletes() {
    this.clientesFiltrados$ = this.clienteControl.valueChanges.pipe(
      startWith(''),
      map((val) => {
        const term = typeof val === 'string' ? val : (val as Cliente)?.razonSocial || '';
        return term ? this._filterCli(term) : this.listaClientes.slice();
      }),
    );

    this.productosFiltrados$ = this.productoControl.valueChanges.pipe(
      startWith(''),
      debounceTime(250),
      distinctUntilChanged(),
      switchMap((val) => {
        if (typeof val !== 'string') return of(val ? [val] : []);
        return this.productoService.buscarProductos(val.trim(), 25).pipe(catchError(() => of([])));
      }),
    );
  }

  seleccionarCliente(c: Cliente) {
    this.clienteSeleccionado = c;
    this.recalcularCarrito();
  }

  agregarProducto(p: Producto) {
    const existente = this.carrito.find((i) => i.idProducto === p.idProducto);
    if (existente) {
      existente.cantidad++;
      this.recalcularRenglon(existente);
    } else {
      const nuevo: ConceptoCotizacion = {
        idProducto: p.idProducto,
        descripcion: p.descripcion,
        unidadDescripcion: p.descripcionUnidadSat || 'Pieza',
        cantidad: 1,
        valorUnitario: Number(p.precioUnitario),
        importe: 0,
        importeIva: 0,
        importeRetIsr: 0,
        tasaIva: p.tasaIva,
        objetoImpuesto: p.objetoImpuestoSat,
        aplicaRetencionIsr: p.aplicaRetencionIsr,
      };
      this.recalcularRenglon(nuevo);
      this.carrito.push(nuevo);
    }
    this.productoControl.setValue('');
    this.carrito = [...this.carrito];
    this.recalcularTotales();
  }

  recalcularRenglon(item: ConceptoCotizacion) {
    item.importe = roundMoney(item.cantidad * item.valorUnitario);

    // IVA
    if (item.objetoImpuesto === '02') {
      item.importeIva = roundMoney(item.importe * (item.tasaIva || 0));
    } else {
      item.importeIva = 0;
    }

    // Retención ISR
    const rfc = this.clienteSeleccionado?.rfc || '';
    if (item.aplicaRetencionIsr && rfc.length === 12) {
      item.importeRetIsr = roundMoney(item.importe * 0.0125);
    } else {
      item.importeRetIsr = 0;
    }
  }

  alCambiarValor(item: ConceptoCotizacion) {
    if (!Number.isFinite(item.cantidad) || item.cantidad < 0.000001) item.cantidad = 1;
    if (!Number.isFinite(item.valorUnitario) || item.valorUnitario < 0) item.valorUnitario = 0;
    this.recalcularRenglon(item);
    this.recalcularTotales();
  }

  recalcularCarrito() {
    this.carrito.forEach((item) => {
      this.recalcularRenglon(item);
    });
    this.recalcularTotales();
  }

  recalcularTotales() {
    this.subtotalGeneral = this.carrito.reduce((acc, i) => acc + i.importe, 0);
    this.ivaGeneral = this.carrito.reduce((acc, i) => acc + i.importeIva, 0);
    this.retIsrGeneral = this.carrito.reduce((acc, i) => acc + i.importeRetIsr, 0);
    this.totalGeneral = roundMoney(this.subtotalGeneral + this.ivaGeneral - this.retIsrGeneral);
  }

  eliminar(index: number) {
    this.carrito.splice(index, 1);
    this.carrito = [...this.carrito];
    this.recalcularTotales();
  }

  guardar() {
    if (this.isSaving()||this.revisionLoading()||this.revisionError()) return;
    if (!this.clienteSeleccionado || this.carrito.length === 0) {
      this.snackBar.open('Selecciona cliente y productos', 'Ok', { duration: 3000 });
      return;
    }

    const dto: CreateCotizacion = {
      idCliente: this.clienteSeleccionado.idCliente,
      nombreReceptor: this.clienteSeleccionado.razonSocial,
      rfcReceptor: this.clienteSeleccionado.rfc,
      subtotal: Number(this.subtotalGeneral),
      totalImpuestos: Number(this.ivaGeneral),
      totalRetenciones: Number(this.retIsrGeneral),
      total: Number(this.totalGeneral),
      conceptos: this.carrito.map((item) => ({
        idProducto: item.idProducto,
        descripcion: item.descripcion,
        unidadDescripcion: item.unidadDescripcion,
        cantidad: Number(item.cantidad),
        valorUnitario: Number(item.valorUnitario),
        importe: Number(item.importe),
        importeIva: Number(item.importeIva),
        importeRetIsr: Number(item.importeRetIsr),
      })),
    };

    if(this.revisionSource){if(!this.revisionId||!this.revisionMotive.value.trim()){this.snackBar.open('Indica el motivo de la nueva revisión.','Cerrar');return;}
      try{const body={...dto,revisionAnterior:this.revisionId,motivo:this.revisionMotive.value.trim()},requestId=this.revisionIntent.begin('revision',body);this.isSaving.set(true);
      this.versions.revise(this.revisionSource,{...body,requestId}).pipe(finalize(()=>this.isSaving.set(false)),takeUntilDestroyed(this.destroyRef)).subscribe({next:r=>{this.revisionIntent.success('revision');this.router.navigate(['/cotizacion',r.idCotizacion,'versiones']);},error:e=>{this.revisionIntent.failure('revision',e.status);this.snackBar.open(Array.isArray(e.error?.message)?e.error.message.join('. '):e.error?.message||'No se pudo confirmar la revisión. Reintenta sin cambiar los datos.','Cerrar');}});
      }catch(e){this.snackBar.open(e instanceof Error?e.message:'Revisa los datos.','Cerrar');}return;
    }
    this.isSaving.set(true);
    this.cotizacionService
      .crear(dto)
      .pipe(finalize(() => this.isSaving.set(false)))
      .subscribe({
        next: (res) => {
          this.snackBar
            .open('Cotización Guardada', 'Ver PDF', { duration: 5000 })
            .onAction()
            .subscribe(() => this.abrirPdf(res.id));
          this.limpiar();
        },
        error: (e) => this.snackBar.open('Error: ' + e.message, 'Ok'),
      });
  }

  abrirPdf(id: number) {
    this.cotizacionService.descargarPdf(id).subscribe((blob) => {
      downloadDocument(blob, `Cotizacion_${id}.pdf`);
    });
  }

  limpiar() {
    this.carrito = [];
    this.clienteSeleccionado = null;
    this.clienteControl.setValue('');
    this.recalcularTotales();
  }

  displayCli(c: Cliente) {
    return c ? c.razonSocial : '';
  }
  displayProd(p: Producto) {
    return p ? p.descripcion : '';
  }

  _filterCli(t: string) {
    const v = t.toLowerCase();
    return this.listaClientes.filter((c) => (c.razonSocial || '').toLowerCase().includes(v));
  }
}
