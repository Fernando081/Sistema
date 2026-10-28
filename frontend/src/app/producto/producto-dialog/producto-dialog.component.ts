// frontend/src/app/producto/producto-dialog/producto-dialog.component.ts
import { Component, Inject, OnInit, DestroyRef, inject, signal } from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
  FormControl,
} from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { CommonModule } from '@angular/common';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTabsModule } from '@angular/material/tabs';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { EChartsCoreOption as EChartsOption } from 'echarts/core';

import { ProductoService } from '../../services/producto.service';
import { Producto, KardexItem } from '../producto.interface';
import { CategoriaService } from '../../services/categoria.service';
import { Categoria } from '../../categoria/categoria.interface';
import {
  CatalogosService,
  Unidad,
  ObjetoImpuesto,
  ClaveProdServ,
  ClaveUnidad,
} from '../../services/catalogos.service';

import { Observable, of } from 'rxjs';
import { debounceTime, switchMap, startWith, map, finalize, catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { ErpEchartsDirective } from '../../shared/echarts.provider';
import { ConfirmService } from '../../shared/confirm.service';
import { AuthService } from '../../auth/auth.service';
import { WebProductEditorComponent } from '../web-product-editor.component';

import { HistorialPrecio, ProductoEquivalente, NumeroParte, AplicacionProducto, CotizacionProveedor } from '../../services/producto-api.types';
import { productImageUrl } from '../../shared/api-url';

@Component({
  selector: 'app-producto-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatAutocompleteModule,
    MatCheckboxModule,
    MatTabsModule,
    MatListModule,
    MatIconModule,
    ErpEchartsDirective,
    MatSnackBarModule,
    WebProductEditorComponent,
  ],
  templateUrl: './producto-dialog.component.html',
})
export class ProductoDialogComponent implements OnInit {
  readonly canPrepareWeb = inject(AuthService).getSessionIdentity()?.role === 'admin';
  selectedTab = 0;
  get webTabActive() { return this.canPrepareWeb && this.isEditMode && this.selectedTab === 0; }
  form: FormGroup;
  isEditMode: boolean;
  isSaving = signal(false);
  destroyRef = inject(DestroyRef);

  selectedFiles: File[] = [];
  previewUrls = signal<{file?: File, url: string}[]>([]);

  // Observables Catálogos
  public categoria$!: Observable<Categoria[]>;
  public unidades$!: Observable<Unidad[]>;
  public objetosImpuesto$!: Observable<ObjetoImpuesto[]>;
  public filteredClavesProdServ$!: Observable<ClaveProdServ[]>;
  public filteredClavesUnidad$!: Observable<ClaveUnidad[]>;

  // --- VARIABLES PARA PESTAÑAS AVANZADAS ---
  historialPrecios: HistorialPrecio[] = [];
  equivalentes = signal<ProductoEquivalente[]>([]);
  numerosParte = signal<NumeroParte[]>([]);
  aplicaciones = signal<AplicacionProducto[]>([]);
  kardex = signal<KardexItem[]>([]);
  cotizacionesProveedor = signal<CotizacionProveedor[]>([]);
  numeroParteForm: FormGroup;
  aplicacionForm: FormGroup;

  // Para el buscador de Equivalentes
  buscadorEquivalenteControl = new FormControl('');
  productosCandidatos$: Observable<Producto[]> = of([]);
  listaTodosProductos: Producto[] = []; // Cargaremos aquí todos para filtrar localmente

  // Gráfica
  chartData = signal<EChartsOption | null>(null);

  constructor(
    private fb: FormBuilder,
    private productoService: ProductoService,
    private categoriaService: CategoriaService,
    private catalogosService: CatalogosService,
    private dialogRef: MatDialogRef<ProductoDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: Producto,
    private snackBar: MatSnackBar,
    private confirm: ConfirmService,
  ) {
    this.isEditMode = !!data;

    this.form = this.fb.group({
      codigo: ['', [Validators.maxLength(30)]],
      descripcion: ['', [Validators.required, Validators.maxLength(255)]],
      precioUnitario: [0, [Validators.required, Validators.min(0)]],
      idCategoria: [null, Validators.required],
      ubicacion: ['', [Validators.maxLength(100)]],
      marca: ['', [Validators.maxLength(50)]],
      idUnidad: [null],
      idObjetoImpuesto: [null],
      claveProdServControl: [null],
      claveUnidadControl: [null],
      objetoImpuestoSat: ['02'],
      tasaIva: [0.16, [Validators.required, Validators.min(0)]],
      aplicaRetencionIsr: [false],
      aplicaRetencionIva: [false],
    });
    this.numeroParteForm = this.fb.group({
      tipo: ['OEM', Validators.required], fabricante: [''], numero: ['', Validators.required],
    });
    this.aplicacionForm = this.fb.group({
      fabricanteEquipo: [''], modelo: [''], motor: [''], anioDesde: [null],
      anioHasta: [null], restricciones: [''],
    });
  }

  ngOnInit(): void {
    // 1. Cargar catálogos
    this.categoria$ = this.categoriaService.getCategorias();
    this.unidades$ = this.catalogosService.getUnidades();
    this.objetosImpuesto$ = this.catalogosService.getObjetosImpuesto();

    // 2. Configurar Autocomplete SAT
    this.filteredClavesProdServ$ = this.form.get('claveProdServControl')!.valueChanges.pipe(
      startWith(''),
      debounceTime(300),
      switchMap((value) => {
        const nombre = typeof value === 'string' ? value : value?.descripcion;
        return typeof value === 'string' && nombre ? this.catalogosService.buscarClaveProdServ(nombre).pipe(catchError(() => of([]))) : of([]);
      }),
    );

    this.filteredClavesUnidad$ = this.form.get('claveUnidadControl')!.valueChanges.pipe(
      startWith(''),
      debounceTime(300),
      switchMap((value) => {
        const nombre = typeof value === 'string' ? value : value?.descripcion;
        return typeof value === 'string' && nombre ? this.catalogosService.buscarClaveUnidad(nombre).pipe(catchError(() => of([]))) : of([]);
      }),
    );

    // 3. Si es edición, cargar datos extra
    if (this.isEditMode && this.data) {
      this.form.patchValue(this.data);

      if (this.data.imagenes && this.data.imagenes.length > 0) {
        const urls = this.data.imagenes.map(img => ({ url: productImageUrl(img) })).filter(image => !!image.url);
        this.previewUrls.set(urls);
      }

      // Prellenado visual SAT
      if (this.data.idClaveProdOServ) {
        this.form.get('claveProdServControl')?.setValue({
          idClaveProdOServ: this.data.idClaveProdOServ,
          clave: this.data.claveProdServ,
          descripcion: this.data.descripcionProdServ,
        });
      }
      if (this.data.idClaveUnidad) {
        this.form.get('claveUnidadControl')?.setValue({
          idClaveUnidad: this.data.idClaveUnidad,
          clave: this.data.claveUnidadSat,
          descripcion: this.data.descripcionUnidadSat,
        });
      }

      // Cargar pestañas avanzadas
      this.cargarHistorialPrecios();
      this.cargarEquivalentes();
      this.cargarNumerosParte();
      this.cargarAplicaciones();
      this.cargarOperacionProducto();

      this.configurarBuscadorEquivalentes();
    }
  }

  // --- LÓGICA EQUIVALENTES ---

  configurarBuscadorEquivalentes() {
    this.productosCandidatos$ = this.buscadorEquivalenteControl.valueChanges.pipe(
      startWith(''),
      debounceTime(250),
      switchMap((valor) => {
        const termino = typeof valor === 'string' ? valor.trim() : '';
        if (!termino) return of([]);
        return this.productoService.buscarProductos(termino).pipe(
          map((productos) => productos.filter((p) => p.idProducto !== this.data.idProducto)),
          catchError(() => of([])),
        );
      }),
    );
  }

  private _filtrarProductos(termino: string): Producto[] {
    const filterValue = termino.toLowerCase();

    return this.listaTodosProductos.filter((p) => {
      // --- BLINDAJE ANTI-ERROR ---
      // Si p.descripcion es null, usamos '' (texto vacío) para que no truene
      const descripcion = (p.descripcion || '').toLowerCase();
      const codigo = (p.codigo || '').toLowerCase();

      // Lógica de filtrado
      const coincide = descripcion.includes(filterValue) || codigo.includes(filterValue);

      // Excluir el producto actual (no puede ser equivalente de sí mismo)
      const noEsElMismo = p.idProducto !== this.data.idProducto;

      return coincide && noEsElMismo;
    });
  }

  vincularEquivalente(prod: Producto) {
    // Limpiar input
    this.buscadorEquivalenteControl.setValue('');

    // Llamar al backend
    this.productoService.agregarEquivalente(this.data.idProducto, prod.idProducto).subscribe({
      next: () => {
        this.mostrarNotificacion('Producto vinculado correctamente');
        this.cargarEquivalentes();
      },
      error: (err) => this.mostrarNotificacion('Error: ' + err.message),
    });
  }

  desvincularEquivalente(idEq: number) {
    this.confirm.ask({ title: 'Desvincular equivalente', message: 'Este producto dejará de aparecer como equivalente sugerido.', confirmLabel: 'Desvincular' }).subscribe(confirmed => {
      if (!confirmed) return;
      this.productoService.eliminarEquivalente(this.data.idProducto, idEq).subscribe(() => this.cargarEquivalentes());
    });
  }

  cargarEquivalentes() {
    this.productoService.getEquivalentes(this.data.idProducto).subscribe((res) => {
      this.equivalentes.set(res);
    });
  }

  cargarNumerosParte() {
    this.productoService.getNumerosParte(this.data.idProducto).subscribe((rows) => this.numerosParte.set(rows));
  }
  agregarNumeroParte() {
    if (this.numeroParteForm.invalid) return;
    this.productoService.addNumeroParte(this.data.idProducto, this.numeroParteForm.getRawValue()).subscribe(() => {
      this.numeroParteForm.reset({ tipo: 'OEM', fabricante: '', numero: '' });
      this.cargarNumerosParte();
    });
  }
  eliminarNumeroParte(idNumero: number) {
    this.productoService.deleteNumeroParte(this.data.idProducto, idNumero).subscribe(() => this.cargarNumerosParte());
  }
  cargarAplicaciones() {
    this.productoService.getAplicaciones(this.data.idProducto).subscribe((rows) => this.aplicaciones.set(rows));
  }
  agregarAplicacion() {
    this.productoService.addAplicacion(this.data.idProducto, this.aplicacionForm.getRawValue()).subscribe(() => {
      this.aplicacionForm.reset();
      this.cargarAplicaciones();
    });
  }
  eliminarAplicacion(idAplicacion: number) {
    this.productoService.deleteAplicacion(this.data.idProducto, idAplicacion).subscribe(() => this.cargarAplicaciones());
  }

  cargarOperacionProducto() {
    this.productoService.getKardex(this.data.idProducto).subscribe(rows => this.kardex.set(rows.slice(0, 25)));
    this.productoService.getCotizacionesProveedor(this.data.idProducto).subscribe(rows => this.cotizacionesProveedor.set(rows));
  }

  // --- LÓGICA HISTORIAL ---

  cargarHistorialPrecios() {
    this.productoService.getHistorialPrecios(this.data.idProducto).subscribe((data) => {
      if (data.length > 0) {
        const fechas = data.map((h) => new Date(h.fecha).toLocaleDateString());
        const precios = data.map((h) => Number(h.precio));

        this.chartData.set({
          tooltip: { trigger: 'axis' },
          xAxis: { type: 'category', data: fechas },
          yAxis: { type: 'value' },
          series: [
            {
              data: precios,
              type: 'line',
              smooth: true,
              itemStyle: { color: 'var(--c-chart-1)' },
            },
          ],
        });
      } else {
        this.chartData.set(null);
      }
    });
  }

  // --- UTILIDADES ---

  displayClave(item: { clave?: string; descripcion?: string } | null): string {
    return item ? `${item.clave} - ${item.descripcion}` : '';
  }

  displayProdSimple(prod: Producto): string {
    return prod ? prod.descripcion : '';
  }

  mostrarNotificacion(mensaje: string) {
    this.snackBar.open(mensaje, 'Cerrar', { duration: 3000 });
  }
  cerrar() {
    this.dialogRef.close();
  }

  onFileSelected(event: Event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const files = input.files;
    if (files && files.length > 0) {
      Array.from(files).forEach((file) => {
        if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 5 * 1024 * 1024) {
          this.mostrarNotificacion('Selecciona una imagen JPG, PNG, WebP o GIF de máximo 5 MB.'); return;
        }
        if (this.selectedFiles.length >= 5 || this.previewUrls().filter(preview => !preview.file).length + this.selectedFiles.length >= 10) {
          this.mostrarNotificacion('Puedes subir 5 imágenes a la vez y conservar hasta 10 por producto.'); return;
        }
        this.selectedFiles.push(file);
        
        const reader = new FileReader();
        reader.onload = () => {
          const url = reader.result;
          if (typeof url === 'string') this.previewUrls.update(previews => [...previews, { file, url }]);
        };
        reader.readAsDataURL(file);
      });
    }
    // Resetear el input para permitir seleccionar la misma foto si se borró
    input.value = '';
  }

  eliminarImagenA(index: number) {
    const current = [...this.previewUrls()];
    const removed = current.splice(index, 1)[0];
    this.previewUrls.set(current);
    
    if (removed.file) {
      this.selectedFiles = this.selectedFiles.filter(f => f !== removed.file);
    }
  }

  guardar(): void {
    if (this.isSaving() || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const prodServ = this.form.get('claveProdServControl')?.value;
    const unidad = this.form.get('claveUnidadControl')?.value;
    if ((typeof prodServ === 'string' && prodServ.trim()) || (typeof unidad === 'string' && unidad.trim())) {
      this.mostrarNotificacion('Selecciona las claves SAT desde los resultados del buscador.'); return;
    }
    
    this.isSaving.set(true);

    if (this.selectedFiles.length > 0) {
      this.productoService.uploadImages(this.selectedFiles).subscribe({
        next: (res) => {
          // Extraer URLs previas (las que NO son archivos nuevos)
          const baseUrl = environment.apiBaseUrl.replace('/api/v1', '');
          const oldUrls = this.previewUrls()
             .filter(p => !p.file)
             .map(p => p.url.replace(baseUrl, '')); // Quitar el host local para bd
             
          // Combinar historicas + nuevas
          const finalUrls = [...oldUrls, ...res.urls];
          this.ejecutarGuardado(finalUrls);
        },
        error: (err) => {
          this.isSaving.set(false);
          this.mostrarNotificacion('Error al subir imágenes: ' + err.message);
        }
      });
    } else {
      const baseUrl = environment.apiBaseUrl.replace('/api/v1', '');
      const oldUrls = this.previewUrls()
         .filter(p => !p.file)
         .map(p => p.url.replace(baseUrl, ''));
      this.ejecutarGuardado(oldUrls);
    }
  }

  private ejecutarGuardado(imagenesArray: string[]) {
    const formData = this.form.getRawValue();

    const idClaveProdOServ = formData.claveProdServControl?.idClaveProdOServ
      ? formData.claveProdServControl.idClaveProdOServ
      : this.data?.idClaveProdOServ;

    const idClaveUnidad = formData.claveUnidadControl?.idClaveUnidad
      ? formData.claveUnidadControl.idClaveUnidad
      : this.data?.idClaveUnidad;

    const dataToSave = {
      ...formData,
      precioUnitario: Number(formData.precioUnitario),
      tasaIva: Number(formData.tasaIva),
      idClaveProdOServ,
      idClaveUnidad,
      claveProdServControl: undefined,
      claveUnidadControl: undefined,
      imagenes: imagenesArray
    };

    const request = this.isEditMode
      ? this.productoService.updateProducto(this.data.idProducto, dataToSave)
      : this.productoService.createProducto(dataToSave);

    request.pipe(finalize(() => this.isSaving.set(false))).subscribe({
      next: () => {
        this.mostrarNotificacion(this.isEditMode ? 'Actualizado' : 'Creado');
        this.dialogRef.close(true);
      },
      error: (err) => {
        this.mostrarNotificacion('Error: ' + err.message);
      },
    });
  }
}
