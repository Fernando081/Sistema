// frontend/src/app/cotizacion/nueva-cotizacion/nueva-cotizacion.component.ts
import { Component, OnInit } from '@angular/core';
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
import { CotizacionService, ConceptoCotizacion, CreateCotizacion } from '../../services/cotizacion.service';
import { Producto } from '../../producto/producto.interface';
import { Cliente } from '../../cliente/cliente.interface';

import { Observable, of } from 'rxjs';
import { map, startWith } from 'rxjs/operators';

@Component({
  selector: 'app-nueva-cotizacion',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, FormsModule,
    MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule,
    MatIconModule, MatTableModule, MatAutocompleteModule, MatSnackBarModule,
    MatDividerModule
  ],
  templateUrl: './nueva-cotizacion.component.html',
})
export class NuevaCotizacionComponent implements OnInit {
  
  carrito: ConceptoCotizacion[] = [];
  clienteSeleccionado: Cliente | null = null;
  
  // Totales
  subtotalGeneral = 0;
  ivaGeneral = 0;
  retIsrGeneral = 0;
  totalGeneral = 0;

  // Controles
  clienteControl = new FormControl<string | Cliente>('');
  productoControl = new FormControl<string | Producto>('');
  
  listaClientes: Cliente[] = [];
  listaProductos: Producto[] = [];
  clientesFiltrados$: Observable<Cliente[]> = of([]);
  productosFiltrados$: Observable<Producto[]> = of([]);

  displayedColumns: string[] = ['descripcion', 'cantidad', 'precio', 'importe', 'acciones'];

  constructor(
    private productoService: ProductoService,
    private clienteService: ClienteService,
    private cotizacionService: CotizacionService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.cargarCatalogos();
    this.configurarAutocompletes();
  }

  cargarCatalogos() {
    // Cargar Clientes
    this.clienteService.getClientes().subscribe(data => {
      this.listaClientes = data;
    });

    // Cargar Productos
    this.productoService.getProductos().subscribe(data => {
      this.listaProductos = data.map(p => ({
        idProducto: p['IdProducto'],
        codigo: p['Codigo'],
        descripcion: p['Descripcion'],
        precioUnitario: p['PrecioUnitario'],
        descripcionUnidadSat: p['DescripcionUnidadSat'],
        objetoImpuestoSat: p['ObjetoImpuesto'],
        tasaIva: p['TasaIVA'],
        aplicaRetencionIsr: p['AplicaRetencionISR']
      })) as unknown as Producto[];
    });
  }

  configurarAutocompletes() {
    this.clientesFiltrados$ = this.clienteControl.valueChanges.pipe(
      startWith(''),
      map(val => {
        const term = typeof val === 'string' ? val : (val as Cliente)?.razonSocial || '';
        return term ? this._filterCli(term) : this.listaClientes.slice();
      })
    );

    this.productosFiltrados$ = this.productoControl.valueChanges.pipe(
      startWith(''),
      map(val => {
        const term = typeof val === 'string' ? val : (val as Producto)?.descripcion || '';
        return term ? this._filterProd(term) : this.listaProductos.slice();
      })
    );
  }

  seleccionarCliente(c: Cliente) {
    this.clienteSeleccionado = c;
    this.recalcularCarrito();
  }

  agregarProducto(p: Producto) {
    const existente = this.carrito.find(i => i.idProducto === p.idProducto);
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
        aplicaRetencionIsr: p.aplicaRetencionIsr
      };
      this.recalcularRenglon(nuevo);
      this.carrito.push(nuevo);
    }
    this.productoControl.setValue('');
    this.carrito = [...this.carrito];
    this.recalcularTotales();
  }

  recalcularRenglon(item: ConceptoCotizacion) {
    item.importe = item.cantidad * item.valorUnitario;

    // IVA
    if (item.objetoImpuesto === '02') {
      item.importeIva = item.importe * (item.tasaIva || 0);
    } else {
      item.importeIva = 0;
    }

    // Retención ISR
    const rfc = this.clienteSeleccionado?.rfc || '';
    if (item.aplicaRetencionIsr && rfc.length === 12) {
      item.importeRetIsr = item.importe * 0.0125;
    } else {
      item.importeRetIsr = 0;
    }
  }

  alCambiarValor(item: ConceptoCotizacion) {
    if (item.cantidad < 1) item.cantidad = 1;
    if (item.valorUnitario < 0) item.valorUnitario = 0;
    this.recalcularRenglon(item);
    this.recalcularTotales();
  }

  recalcularCarrito() {
    this.carrito.forEach(item => {
      this.recalcularRenglon(item);
    });
    this.recalcularTotales();
  }

  recalcularTotales() {
    this.subtotalGeneral = this.carrito.reduce((acc, i) => acc + i.importe, 0);
    this.ivaGeneral = this.carrito.reduce((acc, i) => acc + i.importeIva, 0);
    this.retIsrGeneral = this.carrito.reduce((acc, i) => acc + i.importeRetIsr, 0);
    this.totalGeneral = this.subtotalGeneral + this.ivaGeneral - this.retIsrGeneral;
  }

  eliminar(index: number) {
    this.carrito.splice(index, 1);
    this.carrito = [...this.carrito];
    this.recalcularTotales();
  }

  guardar() {
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
      conceptos: this.carrito.map(item => ({
        idProducto: item.idProducto,
        descripcion: item.descripcion,
        unidadDescripcion: item.unidadDescripcion,
        cantidad: Number(item.cantidad),
        valorUnitario: Number(item.valorUnitario),
        importe: Number(item.importe),
        importeIva: Number(item.importeIva),
        importeRetIsr: Number(item.importeRetIsr)
      }))
    };

    this.cotizacionService.crear(dto).subscribe({
      next: (res) => {
        this.snackBar.open('Cotización Guardada', 'Ver PDF', { duration: 5000 })
          .onAction().subscribe(() => this.abrirPdf(res.id));
        this.limpiar();
      },
      error: (e) => this.snackBar.open('Error: ' + e.message, 'Ok')
    });
  }

  abrirPdf(id: number) {
    this.cotizacionService.descargarPdf(id).subscribe(blob => {
      const url = window.URL.createObjectURL(blob);
      window.open(url);
    });
  }

  limpiar() {
    this.carrito = [];
    this.clienteSeleccionado = null;
    this.clienteControl.setValue('');
    this.recalcularTotales();
  }

  displayCli(c: Cliente) { return c ? c.razonSocial : ''; }
  displayProd(p: Producto) { return p ? p.descripcion : ''; }
  
  _filterCli(t: string) { 
    const v = t.toLowerCase(); 
    return this.listaClientes.filter(c => (c.razonSocial || '').toLowerCase().includes(v)); 
  }
  _filterProd(t: string) { 
    const v = t.toLowerCase(); 
    return this.listaProductos.filter(p => (p.descripcion || '').toLowerCase().includes(v)); 
  }
}