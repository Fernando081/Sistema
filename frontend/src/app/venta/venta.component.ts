// frontend/src/app/venta/venta.component.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

// Material Imports
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatSelectModule } from '@angular/material/select';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

// Servicios e Interfaces
import { ProductoService } from '../services/producto.service';
import { ClienteService } from '../services/cliente.service';
import { CatalogosService, FormaPago, MetodoPago, UsoCFDI } from '../services/catalogos.service';
import { VentaService } from '../services/venta.service';
import { Producto } from '../producto/producto.interface';
import { Cliente } from '../cliente/cliente.interface';
import { ConceptoVenta, Venta } from './venta.interface';

// RxJS
import { Observable, of } from 'rxjs';
import { map, startWith } from 'rxjs/operators';

@Component({
  selector: 'app-venta',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, MatCardModule, MatFormFieldModule,
    MatInputModule, MatButtonModule, MatIconModule, MatTableModule,
    MatAutocompleteModule, MatSelectModule, MatDividerModule, MatSnackBarModule, FormsModule, MatProgressSpinnerModule
  ],
  templateUrl: './venta.component.html',
  // Elimina styleUrls si no tienes el archivo CSS
})
export class VentaComponent implements OnInit {
  
  // --- VARIABLES DE ESTADO ---
  carrito: ConceptoVenta[] = [];
  clienteSeleccionado: Cliente | null = null;
  
  // Totales Globales
  subtotalGeneral = 0;
  ivaGeneral = 0;
  retIsrGeneral = 0;
  totalGeneral = 0;

  // Formularios y Controles
  clienteControl = new FormControl<string | Cliente>('');
  productoControl = new FormControl<string | Producto>('');
  
  // Formulario de configuración de factura (Uso CFDI, Método Pago, etc.)
  configForm: FormGroup;

  // Listas para Autocomplete y Selects
  clientesFiltrados$: Observable<Cliente[]> = of([]);
  productosFiltrados$: Observable<Producto[]> = of([]);
  listaClientes: Cliente[] = [];
  listaProductos: Producto[] = [];
  
  // Catálogos SAT
  usosCfdi$: Observable<UsoCFDI[]> = of([]);
  formasPago$: Observable<FormaPago[]> = of([]);
  metodosPago$: Observable<MetodoPago[]> = of([]);

  displayedColumns: string[] = ['descripcion', 'cantidad', 'precio', 'importe', 'acciones'];
  guardandoVenta = false;

  constructor(
    private fb: FormBuilder,
    private productoService: ProductoService,
    private clienteService: ClienteService,
    private catalogosService: CatalogosService,
    private ventaService: VentaService,
    private snackBar: MatSnackBar
  ) {
    this.configForm = this.fb.group({
      idUsoCFDI: [null, Validators.required],
      idFormaPago: [null, Validators.required],
      idMetodoPago: [null, Validators.required]
    });
  }

  ngOnInit(): void {
    this.cargarCatalogos();
    this.configurarAutocompletes();
  }

  cargarCatalogos() {
    // 1. Cargar Catálogos SAT
    this.usosCfdi$ = this.catalogosService.getUsosCFDI();
    this.formasPago$ = this.catalogosService.getFormasPago();
    this.metodosPago$ = this.catalogosService.getMetodosPago();

    // 2. Cargar Clientes
    this.clienteService.getClientes().subscribe(data => {
      this.listaClientes = data;
    });

    // 3. Cargar Productos (Mapeo COMPLETO)
    this.productoService.getProductos().subscribe(data => {
      this.listaProductos = data.map(p => ({
        // Identificadores
        idProducto: p['IdProducto'],
        
        // Datos Básicos
        codigo: p['Codigo'],
        descripcion: p['Descripcion'],
        precioUnitario: p['PrecioUnitario'],
        marca: p['Marca'],
        ubicacion: p['Ubicacion'],

        // IDs Relacionales
        idUnidad: p['IdUnidad'],
        idObjetoImpuesto: p['IdObjetoImpuesto'],
        idCategoria: p['IdCategoria'],
        idClaveProdOServ: p['IdClaveProdOServ'],
        idClaveUnidad: p['IdClaveUnidad'],
        
        // Datos SAT (Joins)
        claveProdServ: p['ClaveProdServ'],
        descripcionProdServ: p['DescripcionProdServ'],
        claveUnidadSat: p['ClaveUnidadSat'],
        // OJO: En la interfaz es 'descripcionUnidadSat'
        descripcionUnidadSat: p['DescripcionUnidadSat'], 

        // Datos Fiscales (RESICO)
        objetoImpuestoSat: p['ObjetoImpuesto'],
        tasaIva: p['TasaIVA'],
        aplicaRetencionIsr: p['AplicaRetencionISR'],
        aplicaRetencionIva: p['AplicaRetencionIVA'],
        existencia: Number(p['Existencia']),
        equivalentesIds: p['EquivalentesJSON'] || [] // Array de números [2, 5]
      })) as unknown as Producto[];
    });
  }

  configurarAutocompletes() {
    // Filtro Clientes (Validación Objeto vs Texto)
    this.clientesFiltrados$ = this.clienteControl.valueChanges.pipe(
      startWith(''),
      map(value => {
        const termino = typeof value === 'string' ? value : (value as Cliente)?.razonSocial || '';
        return termino ? this._filtrarClientes(termino) : this.listaClientes.slice();
      })
    );

    // Filtro Productos (Validación Objeto vs Texto)
    this.productosFiltrados$ = this.productoControl.valueChanges.pipe(
      startWith(''),
      map(value => {
        const termino = typeof value === 'string' ? value : (value as Producto)?.descripcion || '';
        return termino ? this._filtrarProductos(termino) : this.listaProductos.slice();
      })
    );
  }

  // --- SELECCIÓN DE CLIENTE ---
  seleccionarCliente(cliente: Cliente) {
    this.clienteSeleccionado = cliente;
    
    // Prellenar datos fiscales por defecto del cliente
    this.configForm.patchValue({
      idUsoCFDI: cliente.idUsoCFDI,
      idFormaPago: cliente.idFormaPago,
      idMetodoPago: cliente.idMetodoDePago
    });

    // ¡IMPORTANTE! Recalcular impuestos porque cambió el RFC (Física vs Moral)
    this.recalcularCarrito();
  }

  // --- AGREGAR PRODUCTO AL CARRITO ---
  agregarProducto(producto: Producto) {
    // 1. Validación de Stock (Bonita)
    if (producto.existencia <= 0) {
      this.mostrarNotificacion(`⚠️ No hay stock de "${producto.descripcion}".`);
      this.productoControl.setValue('');
      return;
    }

    // 2. Verificar si ya existe para solo sumar cantidad
    const existente = this.carrito.find(item => item.idProducto === producto.idProducto);
    
    if (existente) {
      // Validar stock acumulado
      if (existente.cantidad + 1 > producto.existencia) {
        this.mostrarNotificacion(`⚠️ Stock insuficiente. Solo quedan ${producto.existencia}.`);
        this.productoControl.setValue('');
        return;
      }

      existente.cantidad++;
      this.recalcularRenglon(existente, producto);
    } else {
      // 3. Crear nuevo concepto
      const nuevoItem: ConceptoVenta = {
        idProducto: producto.idProducto,
        codigo: producto.codigo,
        descripcion: producto.descripcion,
        
        unidadDescripcion: producto.descripcionUnidadSat || 'Unidad', 
        claveProdServ: producto.claveProdServ || '01010101',
        claveUnidad: producto.claveUnidadSat || 'H87',
        objetoImpuesto: producto.objetoImpuestoSat || '02',
        
        cantidad: 1,
        valorUnitario: Number(producto.precioUnitario),
        importe: 0, 
        descuento: 0,
        
        // Impuestos
        baseIva: 0, tasaIva: Number(producto.tasaIva), importeIva: 0,
        baseRetIsr: 0, tasaRetIsr: producto.aplicaRetencionIsr ? 0.0125 : 0, importeRetIsr: 0
      };

      this.recalcularRenglon(nuevoItem, producto);
      this.carrito.push(nuevoItem);
    }

    // Limpiar el buscador de productos
    this.productoControl.setValue('');
    
    // Actualizar la tabla visualmente
    this.carrito = [...this.carrito]; 
    this.recalcularTotalesGenerales();
  }

  // --- CEREBRO MATEMÁTICO (RESICO BLINDADO) ---
  recalcularRenglon(item: ConceptoVenta, productoOriginal: Producto) {
    // 1. Importe base en centavos para evitar errores de coma flotante
    const importeCents = this.toCents(item.cantidad * item.valorUnitario);
    item.importe = this.fromCents(importeCents);

    // 2. IVA
    if (item.objetoImpuesto === '02') {
        item.baseIva = item.importe;
        item.importeIva = this.fromCents(this.toCents(item.baseIva * item.tasaIva));
    } else {
        item.baseIva = 0;
        item.importeIva = 0;
    }

    // 3. RETENCIÓN ISR (Lógica de Oro Blindada)
    // Validamos que exista cliente y que tenga RFC antes de medir su longitud
    const rfcCliente = this.clienteSeleccionado?.rfc || ''; // Si es null, usa ''
    const esClienteMoral = rfcCliente.length === 12; // Ahora '' tiene length 0, no truena
    
    if (productoOriginal.aplicaRetencionIsr && esClienteMoral) {
        item.baseRetIsr = item.importe;
        item.importeRetIsr = this.fromCents(this.toCents(item.baseRetIsr * 0.0125)); // 1.25%
    } else {
        item.importeRetIsr = 0;
    }
  }

  recalcularCarrito() {
    this.carrito.forEach(item => {
        const prodOriginal = this.listaProductos.find(p => p.idProducto === item.idProducto);
        if (prodOriginal) {
            this.recalcularRenglon(item, prodOriginal);
        }
    });
    this.recalcularTotalesGenerales();
  }

  recalcularTotalesGenerales() {
    const subtotalCents = this.carrito.reduce((acc, item) => acc + this.toCents(item.importe), 0);
    const ivaCents = this.carrito.reduce((acc, item) => acc + this.toCents(item.importeIva), 0);
    const retCents = this.carrito.reduce((acc, item) => acc + this.toCents(item.importeRetIsr), 0);

    this.subtotalGeneral = this.fromCents(subtotalCents);
    this.ivaGeneral = this.fromCents(ivaCents);
    this.retIsrGeneral = this.fromCents(retCents);
    this.totalGeneral = this.fromCents(subtotalCents + ivaCents - retCents);
  }

  eliminarDelCarrito(index: number) {
    this.carrito.splice(index, 1);
    this.carrito = [...this.carrito]; // Refrescar tabla
    this.recalcularTotalesGenerales();
  }

  // --- GUARDAR VENTA ---
  guardarVenta() {
    if (this.guardandoVenta) return;
    if (!this.clienteSeleccionado) {
      this.mostrarNotificacion('Debes seleccionar un cliente');
      return;
    }
    if (this.carrito.length === 0) {
      this.mostrarNotificacion('El carrito está vacío');
      return;
    }
    if (this.configForm.invalid) {
        this.configForm.markAllAsTouched();
        this.mostrarNotificacion('Completa los datos fiscales (Uso CFDI, etc.)');
        return;
    }

    const formValues = this.configForm.value;

    const ventaPayload: Venta = {
      idCliente: this.clienteSeleccionado.idCliente,
      // Snapshot de datos del cliente
      rfcReceptor: this.clienteSeleccionado.rfc,
      nombreReceptor: this.clienteSeleccionado.razonSocial,
      cpReceptor: this.clienteSeleccionado.codigoPostal,
      
      regimenReceptor: '601', // Ajustar según lógica real
      usoCfdi: this._obtenerClaveUso(formValues.idUsoCFDI),

      idFormaPago: formValues.idFormaPago,
      idMetodoPago: formValues.idMetodoPago,
      moneda: 'MXN',
      tipoCambio: 1,

      subtotal: this.subtotalGeneral,
      totalImpuestosTrasladados: this.ivaGeneral,
      totalImpuestosRetenidos: this.retIsrGeneral,
      total: this.totalGeneral,

      conceptos: this.carrito
    };

    this.guardandoVenta = true;
    this.ventaService.crearVenta(ventaPayload).subscribe({
      next: (res) => {
        this.mostrarNotificacion('Venta guardada con éxito. Folio: ' + res.idFactura);
        this.limpiarTodo();
        this.ngOnInit();
      },
      complete: () => {
        this.guardandoVenta = false;
      },
      error: (error) => {
        this.guardandoVenta = false;
        let mensaje = 'Ocurrió un error al guardar la venta.';
        if (error?.status === 0) {
          mensaje = 'No se pudo conectar con el servidor. Verifica tu conexión e inténtalo de nuevo.';
        } else if (error?.error?.message) {
          mensaje = error.error.message;
        } else if (error?.message) {
          mensaje = error.message;
        }
        this.mostrarNotificacion(mensaje);
      },
    });
  }

  // --- UTILIDADES ---
  limpiarTodo() {
    this.carrito = [];
    this.clienteSeleccionado = null;
    this.clienteControl.setValue('');
    this.productoControl.setValue('');
    this.recalcularTotalesGenerales();
    this.configForm.reset();
  }

  mostrarNotificacion(msg: string) {
    this.snackBar.open(msg, 'Cerrar', { duration: 3000 });
  }

  private toCents(value: number): number {
    return Math.round(value * 100);
  }

  private fromCents(value: number): number {
    return value / 100;
  }

  displayCliente(cliente: Cliente): string {
    return cliente ? `${cliente.razonSocial}` : '';
  }

  displayProducto(producto: Producto): string {
    return producto ? `${producto.descripcion}` : '';
  }

  private _filtrarClientes(termino: string): Cliente[] {
    const filterValue = termino.toLowerCase();
    
    return this.listaClientes.filter(c => {
      const razonSocial = (c.razonSocial || '').toLowerCase();
      const rfc = (c.rfc || '').toLowerCase();
      return razonSocial.includes(filterValue) || rfc.includes(filterValue);
    });
  }

  private _filtrarProductos(termino: string): Producto[] {
    const filterValue = termino.toLowerCase();

    // 1. Búsqueda Directa (Por texto)
    const coincidenciasDirectas = this.listaProductos.filter(p => {
      const descripcion = (p.descripcion || '').toLowerCase();
      const codigo = (p.codigo || '').toLowerCase();
      // Reseteamos la bandera visual
      p.esEquivalente = false; 
      return descripcion.includes(filterValue) || codigo.includes(filterValue);
    });

    // 2. Búsqueda de Equivalentes (Indirecta)
    // Recorremos las coincidencias directas y buscamos sus "hijos"
    const equivalentesEncontrados: Producto[] = [];

    coincidenciasDirectas.forEach(padre => {
      if (padre.equivalentesIds && padre.equivalentesIds.length > 0) {
        // Buscamos los productos reales usando los IDs
        const hijos = this.listaProductos.filter(p => 
            padre.equivalentesIds?.includes(p.idProducto)
        );
        
        hijos.forEach(hijo => {
           // Solo lo agregamos si no estaba ya en la lista directa
           if (!coincidenciasDirectas.includes(hijo)) {
             // Clonamos el objeto para no afectar el original y marcarlo
             const copiaHijo = { ...hijo }; 
             copiaHijo.esEquivalente = true; // Marca visual
             equivalentesEncontrados.push(copiaHijo);
           }
        });
      }
    });

    // 3. Unir listas (Directos + Equivalentes)
    return [...coincidenciasDirectas, ...equivalentesEncontrados];
  }

  // Función auxiliar para obtener la clave string del catálogo
  private _obtenerClaveUso(id: number): string {
    // OJO: Esto es una solución rápida. Lo ideal es guardar la CLAVE en la lista 'usosCfdi$'
    // y buscarla aquí. Asumiremos que 'G03' es el default si no la encontramos.
    // Puedes mejorar esto mapeando 'usosCfdi$' a una variable local.
    return 'G03'; 
  }

  // --- EDICIÓN EN TIEMPO REAL ---
  alCambiarValor(item: ConceptoVenta) {
    // 1. Validaciones básicas (No negativos)
    if (item.cantidad < 1) item.cantidad = 1;
    if (item.valorUnitario < 0) item.valorUnitario = 0;

    // 2. Buscar el producto original para checar stock y reglas fiscales
    const prodOriginal = this.listaProductos.find(p => p.idProducto === item.idProducto);
    
    if (prodOriginal) {
      // Validación de Stock
      if (item.cantidad > prodOriginal.existencia) {
        this.mostrarNotificacion(`⚠️ Stock insuficiente. Máximo: ${prodOriginal.existencia}`);
        item.cantidad = prodOriginal.existencia; // Regresamos al máximo posible
      }

      // 3. Recalcular todo el renglón (Importe, IVA, ISR)
      this.recalcularRenglon(item, prodOriginal);
      
      // 4. Actualizar totales de la factura
      this.recalcularTotalesGenerales();
    }
  }
}