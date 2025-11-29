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
    CommonModule, ReactiveFormsModule, FormsModule, // <--- FormsModule vital para inputs tabla
    MatCardModule, MatFormFieldModule, MatInputModule, 
    MatButtonModule, MatIconModule, MatTableModule, 
    MatAutocompleteModule, MatSnackBarModule
  ],
  templateUrl: './compra.component.html',
})
export class CompraComponent implements OnInit {

  // --- ESTADO ---
  carrito: DetalleCompra[] = [];
  proveedorSeleccionado: Proveedor | null = null;
  totalGeneral = 0;

  // --- FORMULARIOS ---
  proveedorControl = new FormControl<string | Proveedor>('');
  productoControl = new FormControl<string | Producto>('');
  folioFacturaControl = new FormControl(''); // Folio físico del papel del proveedor
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
    // 1. Cargar Proveedores (Mapeo seguro)
    this.proveedorService.getProveedores().subscribe(data => {
      this.listaProveedores = data.map(p => ({
        idProveedor: p['IdProveedor'],
        rfc: p['RFC'],
        razonSocial: p['RazonSocial']
        // ... otros campos si los necesitas
      })) as unknown as Proveedor[];
    });

    // 2. Cargar Productos
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
    // Filtro Proveedores
    this.proveedoresFiltrados$ = this.proveedorControl.valueChanges.pipe(
      startWith(''),
      map(value => {
        const termino = typeof value === 'string' ? value : (value as Proveedor)?.razonSocial || '';
        return termino ? this._filtrarProveedores(termino) : this.listaProveedores.slice();
      })
    );

    // Filtro Productos
    this.productosFiltrados$ = this.productoControl.valueChanges.pipe(
      startWith(''),
      map(value => {
        const termino = typeof value === 'string' ? value : (value as Producto)?.descripcion || '';
        return termino ? this._filtrarProductos(termino) : this.listaProductos.slice();
      })
    );
  }

  // --- ACCIONES ---

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
        costoUnitario: 0, // Inicializamos en 0 para obligar a capturar el costo real
        importe: 0
      };
      this.carrito.push(nuevo);
    }

    this.productoControl.setValue('');
    this.carrito = [...this.carrito]; // Refrescar tabla
    this.recalcularTotalGeneral();
  }

  // --- CÁLCULOS ---

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

  // --- GUARDAR ---

  guardarCompra() {
    if (!this.proveedorSeleccionado) {
      this.mostrarNotificacion('Selecciona un proveedor');
      return;
    }
    if (this.carrito.length === 0) {
      this.mostrarNotificacion('El carrito está vacío');
      return;
    }
    // Validar que hayan puesto costos
    const sinCosto = this.carrito.some(i => i.costoUnitario <= 0);
    if (sinCosto) {
        this.mostrarNotificacion('⚠️ Hay productos con Costo $0.00. Verifica los precios.');
        return;
    }

    const compraPayload: CreateCompra = {
      idProveedor: this.proveedorSeleccionado.idProveedor,
      folioFactura: this.folioFacturaControl.value || '',
      observaciones: this.observacionesControl.value || '',
      
      // Aseguramos que el total sea número
      total: Number(this.totalGeneral), 
      
      // Mapeamos el carrito para asegurar que cantidad y costos sean números
      conceptos: this.carrito.map(item => ({
        idProducto: item.idProducto,
        descripcion: item.descripcion,
        codigo: item.codigo || '', // Enviamos el código (ahora el backend lo acepta)
        cantidad: Number(item.cantidad),
        costoUnitario: Number(item.costoUnitario),
        importe: Number(item.importe)
      }))
    };

    this.compraService.crearCompra(compraPayload).subscribe({
      next: (res) => {
        this.mostrarNotificacion('✅ Compra registrada. Inventario actualizado.');
        this.limpiarTodo();
        // Recargar productos para ver la nueva existencia si volvemos a buscar
        this.ngOnInit();
      },
      error: (err) => {
        // Tip: Si vuelve a fallar, esto imprime en consola qué campo falló
        console.error('Detalle del error:', err.error.message); 
        this.mostrarNotificacion('Error: ' + (Array.isArray(err.error.message) ? err.error.message[0] : err.message));
      }
    });
  }

  // --- UTILIDADES ---

  limpiarTodo() {
    this.carrito = [];
    this.proveedorSeleccionado = null;
    this.proveedorControl.setValue('');
    this.productoControl.setValue('');
    this.folioFacturaControl.setValue('');
    this.observacionesControl.setValue('');
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