// frontend/src/app/compra/compra.component.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';

// Material
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle'; // <--- IMPORTAR

// Servicios e Interfaces
import { CompraService } from '../services/compra.service';
import { ProveedorService } from '../services/proveedor.service';
import { ProductoService } from '../services/producto.service';
import { Proveedor } from '../proveedor/proveedor.interface';
import { Producto } from '../producto/producto.interface';
import { DetalleCompra, CreateCompra } from './compra.interface';

import { Observable, of } from 'rxjs';
import { map, startWith } from 'rxjs/operators';

@Component({
  selector: 'app-compra',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, FormsModule,
    MatCardModule, MatFormFieldModule, MatInputModule, 
    MatButtonModule, MatIconModule, MatTableModule, 
    MatAutocompleteModule, MatSnackBarModule,
    MatSlideToggleModule // <--- AGREGAR
  ],
  templateUrl: './compra.component.html',
})
export class CompraComponent implements OnInit {

  // --- ESTADO ---
  carrito: DetalleCompra[] = [];
  proveedorSeleccionado: Proveedor | null = null;
  totalGeneral = 0;
  
  // Variable para crédito
  esCredito: boolean = false; 

  // --- FORMULARIOS ---
  proveedorControl = new FormControl<string | Proveedor>('');
  productoControl = new FormControl<string | Producto>('');
  folioFacturaControl = new FormControl('');
  observacionesControl = new FormControl('');

  // --- LISTAS ---
  listaProveedores: Proveedor[] = [];
  listaProductos: Producto[] = [];
  proveedoresFiltrados$: Observable<Proveedor[]> = of([]);
  productosFiltrados$: Observable<Producto[]> = of([]);

  displayedColumns: string[] = ['descripcion', 'cantidad', 'costo', 'importe', 'acciones'];

  constructor(
    private compraService: CompraService,
    private proveedorService: ProveedorService,
    private productoService: ProductoService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.cargarCatalogos();
    this.configurarAutocompletes();
  }

  cargarCatalogos() {
    this.proveedorService.getProveedores().subscribe(data => {
      this.listaProveedores = data.map(p => ({
        idProveedor: p['IdProveedor'],
        rfc: p['RFC'],
        razonSocial: p['RazonSocial']
      })) as unknown as Proveedor[];
    });

    this.productoService.getProductos().subscribe(data => {
      this.listaProductos = data.map(p => ({
        idProducto: p['IdProducto'],
        codigo: p['Codigo'],
        descripcion: p['Descripcion'],
        existencia: Number(p['Existencia'])
      })) as unknown as Producto[];
    });
  }

  configurarAutocompletes() {
    this.proveedoresFiltrados$ = this.proveedorControl.valueChanges.pipe(
      startWith(''),
      map(value => {
        const termino = typeof value === 'string' ? value : (value as Proveedor)?.razonSocial || '';
        return termino ? this._filtrarProveedores(termino) : this.listaProveedores.slice();
      })
    );

    this.productosFiltrados$ = this.productoControl.valueChanges.pipe(
      startWith(''),
      map(value => {
        const termino = typeof value === 'string' ? value : (value as Producto)?.descripcion || '';
        return termino ? this._filtrarProductos(termino) : this.listaProductos.slice();
      })
    );
  }

  seleccionarProveedor(prov: Proveedor) {
    this.proveedorSeleccionado = prov;
  }

  agregarProducto(producto: Producto) {
    const existente = this.carrito.find(i => i.idProducto === producto.idProducto);

    if (existente) {
      existente.cantidad++;
      this.recalcularRenglon(existente);
    } else {
      const nuevo: DetalleCompra = {
        idProducto: producto.idProducto,
        codigo: producto.codigo,
        descripcion: producto.descripcion,
        cantidad: 1,
        costoUnitario: 0,
        importe: 0
      };
      this.carrito.push(nuevo);
    }

    this.productoControl.setValue('');
    this.carrito = [...this.carrito];
    this.recalcularTotalGeneral();
  }

  alCambiarValor(item: DetalleCompra) {
    if (item.cantidad < 1) item.cantidad = 1;
    if (item.costoUnitario < 0) item.costoUnitario = 0;
    this.recalcularRenglon(item);
    this.recalcularTotalGeneral();
  }

  recalcularRenglon(item: DetalleCompra) {
    item.importe = item.cantidad * item.costoUnitario;
  }

  recalcularTotalGeneral() {
    this.totalGeneral = this.carrito.reduce((acc, item) => acc + item.importe, 0);
  }

  eliminarDelCarrito(index: number) {
    this.carrito.splice(index, 1);
    this.carrito = [...this.carrito];
    this.recalcularTotalGeneral();
  }

  guardarCompra() {
    if (!this.proveedorSeleccionado) {
      this.mostrarNotificacion('Selecciona un proveedor');
      return;
    }
    if (this.carrito.length === 0) {
      this.mostrarNotificacion('El carrito está vacío');
      return;
    }
    const sinCosto = this.carrito.some(i => i.costoUnitario <= 0);
    if (sinCosto) {
        this.mostrarNotificacion('⚠️ Hay productos con Costo $0.00.');
        return;
    }

    const compraPayload: CreateCompra = {
      idProveedor: this.proveedorSeleccionado.idProveedor,
      folioFactura: this.folioFacturaControl.value || '',
      esCredito: this.esCredito, // <--- ENVIAMOS EL VALOR DEL TOGGLE
      observaciones: this.observacionesControl.value || '',
      total: Number(this.totalGeneral),
      conceptos: this.carrito.map(item => ({
        idProducto: item.idProducto,
        descripcion: item.descripcion,
        codigo: item.codigo || '',
        cantidad: Number(item.cantidad),
        costoUnitario: Number(item.costoUnitario),
        importe: Number(item.importe)
      }))
    };

    this.compraService.crearCompra(compraPayload).subscribe({
      next: (res) => {
        this.mostrarNotificacion('✅ Compra registrada correctamente.');
        this.limpiarTodo();
        this.ngOnInit();
      },
      error: (err) => {
        console.error(err);
        this.mostrarNotificacion('Error: ' + (err.error?.message || err.message));
      }
    });
  }

  limpiarTodo() {
    this.carrito = [];
    this.proveedorSeleccionado = null;
    this.proveedorControl.setValue('');
    this.productoControl.setValue('');
    this.folioFacturaControl.setValue('');
    this.observacionesControl.setValue('');
    this.esCredito = false; // Resetear toggle
    this.totalGeneral = 0;
  }

  mostrarNotificacion(msg: string) {
    this.snackBar.open(msg, 'Cerrar', { duration: 3000 });
  }

  displayProveedor(p: Proveedor): string { return p ? p.razonSocial : ''; }
  displayProducto(p: Producto): string { return p ? p.descripcion : ''; }

  private _filtrarProveedores(term: string): Proveedor[] {
    const val = term.toLowerCase();
    return this.listaProveedores.filter(p => 
      (p.razonSocial || '').toLowerCase().includes(val) || 
      (p.rfc || '').toLowerCase().includes(val)
    );
  }

  private _filtrarProductos(term: string): Producto[] {
    const val = term.toLowerCase();
    return this.listaProductos.filter(p => 
      (p.descripcion || '').toLowerCase().includes(val) || 
      (p.codigo || '').toLowerCase().includes(val)
    );
  }
}