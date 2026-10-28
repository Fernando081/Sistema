// frontend/src/app/venta/venta.component.ts
import { Component, OnInit, signal, computed, DestroyRef, ElementRef, HostListener, inject, ViewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { roundMoney } from '../shared/document-download';
import { productImageUrl } from '../shared/api-url';
import anime from 'animejs';
import { CommonModule } from '@angular/common';
import {
  FormsModule,
  FormBuilder,
  FormControl,
  FormGroup,
  FormArray,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

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
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { AlternativasDialogComponent } from './alternativas-dialog.component';
import { BuscadorFacturasDialogComponent } from './buscador-facturas-dialog.component';

// Servicios e Interfaces
import { ProductoService } from '../services/producto.service';
import { ClienteService } from '../services/cliente.service';
import { CatalogosService, FormaPago, MetodoPago, UsoCFDI, RegimenFiscal } from '../services/catalogos.service';
import { VentaService } from '../services/venta.service';
import { ComercialService } from '../services/comercial.service';
import { Producto } from '../producto/producto.interface';
import { Cliente } from '../cliente/cliente.interface';
import { ConceptoVenta, Venta } from './venta.interface';
import { AuthService } from '../auth/auth.service';

// RxJS
import { forkJoin, Observable, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, startWith, finalize, switchMap, tap, shareReplay } from 'rxjs/operators';

@Component({
  selector: 'app-venta',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatAutocompleteModule,
    MatSelectModule,
    MatDividerModule,
    MatSnackBarModule,
    FormsModule,
    MatProgressSpinnerModule,
    MatDialogModule
  ],
  templateUrl: './venta.component.html',
  styleUrl: './venta.component.css',
})
export class VentaComponent implements OnInit {
  @ViewChild('productSearchInput') productSearchInput?: ElementRef<HTMLInputElement>;
  readonly productImageUrl = productImageUrl;
  readonly canEditPrice = inject(AuthService).getSessionIdentity()?.role === 'admin';
  // --- VARIABLES DE ESTADO ---
  carrito = signal<ConceptoVenta[]>([]);
  clienteSeleccionado: Cliente | null = null;

  // Totales Globales
  subtotalGeneral = computed(
    () => this.carrito().reduce((acc, item) => acc + this.toCents(item.importe), 0) / 100,
  );
  ivaGeneral = computed(
    () => this.carrito().reduce((acc, item) => acc + this.toCents(item.importeIva), 0) / 100,
  );
  retIsrGeneral = computed(
    () => this.carrito().reduce((acc, item) => acc + this.toCents(item.importeRetIsr), 0) / 100,
  );
  totalGeneral = computed(() => roundMoney(this.subtotalGeneral() + this.ivaGeneral() - this.retIsrGeneral()));

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
  isSaving = signal(false);

  onImageError(event: Event) {
    const image = event.currentTarget as HTMLImageElement;
    image.hidden = true;
    (image.nextElementSibling as HTMLElement | null)?.removeAttribute('hidden');
  }
  private pendingRequestId: string | null = null;
  private readonly destroyRef = inject(DestroyRef);
  private usosCfdi: UsoCFDI[] = [];
  private regimenes: RegimenFiscal[] = [];
  private idFacturaOrigen?: number;
  private readonly draftKey = 'rtt-venta-draft-v1';

  constructor(
    private fb: FormBuilder,
    private productoService: ProductoService,
    private clienteService: ClienteService,
    private catalogosService: CatalogosService,
    private comercialService: ComercialService,
    private ventaService: VentaService,
    private snackBar: MatSnackBar,
    private dialog: MatDialog
  ) {
    this.configForm = this.fb.group({
      tipoComprobante: ['I', Validators.required],
      serie: ['F', Validators.required],
      metodoReembolso: ['Saldo a Favor'], // Default for Egreso
      idUsoCFDI: [null, Validators.required],
      idFormaPago: [null, Validators.required],
      idMetodoPago: [null, Validators.required],
      cfdisRelacionados: this.fb.array([])
    });

    // Cambiar serie automáticamente según tipo de comprobante
    this.configForm.get('tipoComprobante')?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(val => {
      if (val === 'I') {
        this.configForm.get('serie')?.setValue('F');
        this.configForm.get('metodoReembolso')?.clearValidators();
      } else if (val === 'E') {
        this.configForm.get('serie')?.setValue('NC');
        this.configForm.get('metodoReembolso')?.setValidators(Validators.required);
      }
      this.configForm.get('metodoReembolso')?.updateValueAndValidity();
    });
  }

  // --- GETTERS FORM ARRAY ---
  get cfdisRelacionados(): FormArray {
    return this.configForm.get('cfdisRelacionados') as FormArray;
  }

  addCfdiRelacionado() {
    this.cfdisRelacionados.push(this.fb.group({
      tipoRelacion: ['01', Validators.required],
      uuidRelacionado: ['', [Validators.required, Validators.pattern(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/)]]
    }));
  }

  removeCfdiRelacionado(index: number) {
    this.cfdisRelacionados.removeAt(index);
  }

  abrirBuscadorFacturas(index: number) {
    if (!this.clienteSeleccionado) {
      this.mostrarNotificacion('Primero debes seleccionar un cliente.');
      return;
    }

    const dialogRef = this.dialog.open(BuscadorFacturasDialogComponent, {
      width: '700px',
      data: { idCliente: this.clienteSeleccionado.idCliente }
    });

    dialogRef.afterClosed().subscribe(factura => {
      if (factura) {
        this.cfdisRelacionados.at(index).patchValue({ uuidRelacionado: factura.uuid });
        this.idFacturaOrigen = factura.id_factura;
      }
    });
  }

  ngOnInit(): void {
    this.cargarCatalogos();
    this.configurarAutocompletes();
    this.clienteControl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(value => {
      if (typeof value === 'string' || !value) {
        this.clienteSeleccionado = null;
        this.idFacturaOrigen = undefined;
        this.cfdisRelacionados.clear();
      }
    });
  }

  cargarCatalogos() {
    // 1. Cargar Catálogos SAT
    this.usosCfdi$ = this.catalogosService.getUsosCFDI().pipe(tap(rows => this.usosCfdi = rows), shareReplay({ bufferSize: 1, refCount: true }));
    this.catalogosService.getRegimenesFiscales().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(rows => this.regimenes = rows);
    this.formasPago$ = this.catalogosService.getFormasPago();
    this.metodosPago$ = this.catalogosService.getMetodosPago();

    // 2. Cargar Clientes (Service now handles mapping)
    this.clienteService.getClientes().subscribe((data) => {
      this.listaClientes = data;
      this.clienteControl.updateValueAndValidity({ emitEvent: true });
      this.restaurarBorrador();
    });

  }

  configurarAutocompletes() {
    // Filtro Clientes (Validación Objeto vs Texto)
    this.clientesFiltrados$ = this.clienteControl.valueChanges.pipe(
      startWith(''),
      map((value) => {
        const termino = typeof value === 'string' ? value : (value as Cliente)?.razonSocial || '';
        return termino ? this._filtrarClientes(termino) : this.listaClientes.slice();
      }),
    );

    // Filtro Productos (Validación Objeto vs Texto)
    this.productosFiltrados$ = this.productoControl.valueChanges.pipe(
      startWith(''),
      debounceTime(250),
      map((value) => typeof value === 'string' ? value.trim() : ''),
      distinctUntilChanged(),
      switchMap((termino) => this.productoService.buscarProductos(termino).pipe(
        tap((productos) => {
          for (const producto of productos) {
            const index = this.listaProductos.findIndex((p) => p.idProducto === producto.idProducto);
            if (index >= 0) this.listaProductos[index] = producto;
            else this.listaProductos.push(producto);
          }
        }),
        catchError(() => of([])),
      )),
    );
  }

  // --- SELECCIÓN DE CLIENTE ---
  seleccionarCliente(cliente: Cliente) {
    if (this.clienteSeleccionado?.idCliente !== cliente.idCliente) {
      this.idFacturaOrigen = undefined;
      this.cfdisRelacionados.clear();
    }
    this.clienteSeleccionado = cliente;

    // Prellenar datos fiscales por defecto del cliente
    this.configForm.patchValue({
      idUsoCFDI: cliente.idUsoCFDI,
      idFormaPago: cliente.idFormaPago,
      idMetodoPago: cliente.idMetodoDePago,
    });

    // ¡IMPORTANTE! Recalcular impuestos porque cambió el RFC (Física vs Moral)
    this.carrito.update((items) => {
      items.forEach((item) => {
        const prodOriginal = this.listaProductos.find((p) => p.idProducto === item.idProducto);
        if (prodOriginal) {
          this.recalcularRenglon(item, prodOriginal);
        }
      });
      return [...items];
    });
    this.refreshCommercialPrices();
    this.guardarBorrador(false);
  }

  private refreshCommercialPrices() {
    const client = this.clienteSeleccionado;
    const items = this.carrito();
    if (!client || !items.length || this.configForm.value.tipoComprobante === 'E') return;
    forkJoin(items.map((item) => this.comercialService.simular({
      idCliente: client.idCliente,
      idProducto: item.idProducto,
      cantidad: item.cantidad,
    }))).subscribe({
      next: (simulations) => {
        if (simulations.some((result) => result.credito.bloqueado)) {
          this.mostrarNotificacion('El cliente está bloqueado por política comercial.');
          return;
        }
        this.carrito.update((current) => current.map((item, index) => {
          item.valorUnitario = Number(simulations[index].precioSugerido);
          const product = this.listaProductos.find((candidate) => candidate.idProducto === item.idProducto);
          if (product) this.recalcularRenglon(item, product);
          return item;
        }));
        this.guardarBorrador(false);
      },
      error: () => this.mostrarNotificacion('No se pudieron actualizar los precios del cliente.'),
    });
  }

  // --- AGREGAR PRODUCTO AL CARRITO ---
  stockDisponible(producto: Producto): number {
    return Number(producto.disponible ?? producto.existencia ?? 0);
  }

  agregarProducto(producto: Producto, commercialChecked = false) {
    // 1. Validación de Stock + Interceptor de Sustitución en 1-Clic
    if (this.stockDisponible(producto) <= 0 && this.configForm.value.tipoComprobante !== 'E') {
      if (!producto.hasSearchedAlternativas) {
        producto.hasSearchedAlternativas = true;
        this.productoService.getAlternativas(producto.idProducto).subscribe({
          next: alternativas => { producto.alternativas = alternativas; this.agregarProducto(producto); },
          error: () => { producto.hasSearchedAlternativas = false; },
        });
        return;
      }
      if (producto.alternativas && producto.alternativas.length > 0) {
        this.dialog.open(AlternativasDialogComponent, {
           width: '800px',
           data: {
             productoOriginal: producto,
             alternativas: producto.alternativas
           }
        }).afterClosed().subscribe(altSeleccionada => {
           if (altSeleccionada) {
              const prodReal = this.listaProductos.find(p => p.idProducto === altSeleccionada.id_producto);
              if (prodReal) {
                 this.agregarProducto(prodReal);
              } else {
                 this.productoService.getProductoById(altSeleccionada.id_producto).subscribe({
                   next: alternate => { this.listaProductos.push(alternate); this.agregarProducto(alternate); }, error: () => {},
                 });
              }
           }
        });
        return;
      }

      this.mostrarNotificacion(`⚠️ No hay stock de "${producto.descripcion}".`);
      this.productoControl.setValue('');
      return;
    }

    if (!commercialChecked && this.clienteSeleccionado && this.configForm.value.tipoComprobante !== 'E') {
      const current = this.carrito().find((item) => item.idProducto === producto.idProducto);
      const quantity = Number(current?.cantidad || 0) + 1;
      this.comercialService.simular({
        idCliente: this.clienteSeleccionado.idCliente,
        idProducto: producto.idProducto,
        cantidad: quantity,
      }).subscribe({
        next: (simulation) => {
          if (simulation.credito.bloqueado) {
            this.mostrarNotificacion('El cliente está bloqueado por política comercial.');
            return;
          }
          this.agregarProducto({ ...producto, precioUnitario: simulation.precioSugerido }, true);
        },
        error: () => this.mostrarNotificacion('No se pudo validar el precio comercial del producto.'),
      });
      return;
    }

    // 2. Verificar si ya existe para solo sumar cantidad
    const existente = this.carrito().find((item) => item.idProducto === producto.idProducto);

    if (existente) {
      // Validar stock acumulado
      if (existente.cantidad + 1 > this.stockDisponible(producto) && this.configForm.value.tipoComprobante !== 'E') {
        this.mostrarNotificacion(`⚠️ Stock insuficiente. Solo quedan ${this.stockDisponible(producto)} disponibles.`);
        this.productoControl.setValue('');
        return;
      }

      existente.cantidad++;
      existente.valorUnitario = Number(producto.precioUnitario);
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
        baseIva: 0,
        tasaIva: Number(producto.tasaIva),
        importeIva: 0,
        baseRetIsr: 0,
        tasaRetIsr: producto.aplicaRetencionIsr ? 0.0125 : 0,
        importeRetIsr: 0,
        imagenes: producto.imagenes || [],
      };

      this.recalcularRenglon(nuevoItem, producto);
      this.carrito.update((items) => [...items, nuevoItem]);
    }

    // Limpiar el buscador de productos
    this.productoControl.setValue('');

    // Actualizar la tabla visualmente
    if (existente) {
      this.carrito.update((items) => [...items]);
    }
    this.guardarBorrador(false);

    // Animación Pop
    setTimeout(() => {
      anime({ 
        targets: '.totals-card', 
        scale: [1, 1.02, 1], 
        duration: 300, 
        easing: 'easeInOutSine' 
      });
    }, 0);
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
      item.tasaRetIsr = 0.0125;
      item.importeRetIsr = this.fromCents(this.toCents(item.baseRetIsr * 0.0125)); // 1.25%
    } else {
      item.baseRetIsr = 0;
      item.tasaRetIsr = 0;
      item.importeRetIsr = 0;
    }
  }

  eliminarDelCarrito(index: number) {
    this.carrito.update((items) => items.filter((_, i) => i !== index));
    this.guardarBorrador(false);
  }

  cambiarCantidad(item: ConceptoVenta, delta: number) {
    item.cantidad = Math.max(1, item.cantidad + delta);
    this.alCambiarValor(item);
  }

  // --- GUARDAR VENTA ---
  guardarVenta() {
    if (this.isSaving()) return;
    if (!this.clienteSeleccionado) {
      this.mostrarNotificacion('Debes seleccionar un cliente');
      return;
    }
    if (this.carrito().length === 0) {
      this.mostrarNotificacion('El carrito está vacío');
      return;
    }
    if (this.configForm.invalid) {
      this.configForm.markAllAsTouched();
      this.mostrarNotificacion('Completa los datos fiscales (Uso CFDI, etc.)');
      return;
    }

    const formValues = this.configForm.value;
    const usoCfdi = this.usosCfdi.find(uso => uso.idUsoCFDI === formValues.idUsoCFDI)?.clave;
    const regimenReceptor = this.regimenes.find(regimen => regimen.idRegimenFiscal === this.clienteSeleccionado!.idRegimenFiscal)?.clave;
    if (!usoCfdi || !regimenReceptor) {
      this.mostrarNotificacion('Selecciona un uso CFDI válido y revisa el régimen fiscal del cliente.'); return;
    }
    if (formValues.tipoComprobante === 'E' && !this.idFacturaOrigen) {
      this.mostrarNotificacion('Relaciona la factura original usando el buscador para registrar la nota de crédito.'); return;
    }
    if (this.carrito().some(item => !Number.isFinite(item.cantidad) || item.cantidad <= 0 || !Number.isFinite(item.valorUnitario) || item.valorUnitario < 0)) {
      this.mostrarNotificacion('Revisa las cantidades y precios de los productos.'); return;
    }

    const ventaPayload: Venta = {
      requestId: this.pendingRequestId || (this.pendingRequestId = crypto.randomUUID()),
      idCliente: this.clienteSeleccionado.idCliente,
      // Snapshot de datos del cliente
      rfcReceptor: this.clienteSeleccionado.rfc,
      nombreReceptor: this.clienteSeleccionado.razonSocial,
      cpReceptor: this.clienteSeleccionado.codigoPostal,

      regimenReceptor,
      usoCfdi,
      idFacturaOrigen: formValues.tipoComprobante === 'E' ? this.idFacturaOrigen : undefined,

      idFormaPago: formValues.idFormaPago,
      idMetodoPago: formValues.idMetodoPago,
      moneda: 'MXN',
      tipoCambio: 1,

      subtotal: this.subtotalGeneral(),
      totalImpuestosTrasladados: this.ivaGeneral(),
      totalImpuestosRetenidos: this.retIsrGeneral(),
      total: this.totalGeneral(),

      tipoComprobante: formValues.tipoComprobante,
      serie: formValues.serie,
      metodoReembolso: formValues.tipoComprobante === 'E' ? formValues.metodoReembolso : undefined,
      cfdisRelacionados: formValues.cfdisRelacionados,

      conceptos: this.carrito(),
    };

    this.isSaving.set(true);
    this.ventaService
      .crearVenta(ventaPayload)
      .pipe(
        finalize(() => {
          this.isSaving.set(false);
        }),
      )
      .subscribe({
        next: (res) => {
          this.mostrarNotificacion('Venta guardada con éxito. Folio: ' + res.idFactura);
          this.pendingRequestId = null;
          this.limpiarTodo();
        },
        error: () => {
          // Error handling is done by the interceptor
        },
      });
  }

  // --- UTILIDADES ---
  limpiarTodo() {
    this.carrito.set([]);
    this.clienteSeleccionado = null;
    this.clienteControl.setValue('');
    this.productoControl.setValue('');
    this.cfdisRelacionados.clear();
    this.configForm.reset({ tipoComprobante: 'I', serie: 'F', metodoReembolso: 'Saldo a Favor' });
    this.idFacturaOrigen = undefined;
    this.pendingRequestId = null;
    try { localStorage.removeItem(this.draftKey); } catch { /* almacenamiento no disponible */ }
  }

  guardarBorrador(notify = true) {
    if (!this.carrito().length && !this.clienteSeleccionado) return;
    try {
      localStorage.setItem(this.draftKey, JSON.stringify({
        savedAt: new Date().toISOString(), carrito: this.carrito(), idCliente: this.clienteSeleccionado?.idCliente,
        config: { idUsoCFDI: this.configForm.value.idUsoCFDI, idFormaPago: this.configForm.value.idFormaPago, idMetodoPago: this.configForm.value.idMetodoPago },
      }));
      if (notify) this.mostrarNotificacion('Borrador guardado en este equipo');
    } catch { if (notify) this.mostrarNotificacion('No fue posible guardar el borrador'); }
  }

  descartarVenta() {
    if (!this.carrito().length && !this.clienteSeleccionado) return;
    this.limpiarTodo();
    this.mostrarNotificacion('Venta descartada');
  }

  @HostListener('document:keydown', ['$event'])
  handleShortcuts(event: KeyboardEvent) {
    if (event.key === 'F2') { event.preventDefault(); this.productSearchInput?.nativeElement.focus(); }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); this.guardarVenta(); }
  }

  private restaurarBorrador() {
    if (this.carrito().length || this.clienteSeleccionado) return;
    try {
      const raw = localStorage.getItem(this.draftKey);
      if (!raw) return;
      const draft = JSON.parse(raw) as { carrito?: ConceptoVenta[]; idCliente?: number; config?: Record<string, number> };
      if (Array.isArray(draft.carrito)) this.carrito.set(draft.carrito);
      const cliente = this.listaClientes.find(item => item.idCliente === draft.idCliente);
      if (cliente) { this.clienteSeleccionado = cliente; this.clienteControl.setValue(cliente, { emitEvent: false }); }
      if (draft.config) this.configForm.patchValue(draft.config, { emitEvent: false });
      if (draft.carrito?.length) this.mostrarNotificacion('Se recuperó tu venta en proceso');
    } catch { localStorage.removeItem(this.draftKey); }
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

    return this.listaClientes.filter((c) => {
      const razonSocial = (c.razonSocial || '').toLowerCase();
      const rfc = (c.rfc || '').toLowerCase();
      return razonSocial.includes(filterValue) || rfc.includes(filterValue);
    });
  }

  private _filtrarProductos(termino: string): Producto[] {
    const filterValue = termino.toLowerCase();

    // 1. Búsqueda Directa (Por texto)
    const coincidenciasDirectas = this.listaProductos.filter((p) => {
      const descripcion = (p.descripcion || '').toLowerCase();
      const codigo = (p.codigo || '').toLowerCase();
      // Reseteamos la bandera visual
      p.esEquivalente = false;

      const coincide = descripcion.includes(filterValue) || codigo.includes(filterValue);

      // --- LOGICA AUTOPILOT SMART RESTOCK OOS ---
      if (coincide && this.stockDisponible(p) === 0 && !p.hasSearchedAlternativas) {
        p.hasSearchedAlternativas = true;
        this.productoService.getAlternativas(p.idProducto).subscribe({
          next: (alts) => {
            p.alternativas = alts;
            // Fuerza actualización del autocompletado en la UI mutando el Observable
            this.productoControl.setValue(this.productoControl.value);
          }
        });
      }

      return coincide;
    });

    // 2. Búsqueda de Equivalentes (Indirecta)
    // Recorremos las coincidencias directas y buscamos sus "hijos"
    const equivalentesEncontrados: Producto[] = [];

    coincidenciasDirectas.forEach((padre) => {
      if (padre.equivalentesIds && padre.equivalentesIds.length > 0) {
        // Buscamos los productos reales usando los IDs
        const hijos = this.listaProductos.filter((p) =>
          padre.equivalentesIds?.includes(p.idProducto),
        );

        hijos.forEach((hijo) => {
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

  // --- EDICIÓN EN TIEMPO REAL ---
  /** Precio con dos decimales fijos para el campo editable (742.5 → 742.50); el modelo sigue siendo numérico. */
  precioTexto(item: ConceptoVenta): string {
    const valor = Number(item.valorUnitario);
    return Number.isFinite(valor) ? valor.toFixed(2) : '';
  }

  alCambiarValor(item: ConceptoVenta) {
    // 1. Validaciones básicas (No negativos)
    if (!Number.isFinite(item.cantidad) || item.cantidad < 0.0001) item.cantidad = 1;
    if (!Number.isFinite(item.valorUnitario) || item.valorUnitario < 0) item.valorUnitario = 0;

    // 2. Buscar el producto original para checar stock y reglas fiscales
    const prodOriginal = this.listaProductos.find((p) => p.idProducto === item.idProducto);

    if (prodOriginal) {
      // Validación de Stock
      if (item.cantidad > this.stockDisponible(prodOriginal) && this.configForm.value.tipoComprobante !== 'E') {
        this.mostrarNotificacion(`⚠️ Stock insuficiente. Máximo disponible: ${this.stockDisponible(prodOriginal)}`);
        item.cantidad = this.stockDisponible(prodOriginal);
      }

      // 3. Recalcular todo el renglón (Importe, IVA, ISR)
      this.recalcularRenglon(item, prodOriginal);

      this.carrito.update((items) => [...items]);
      this.guardarBorrador(false);
    }
  }
}
