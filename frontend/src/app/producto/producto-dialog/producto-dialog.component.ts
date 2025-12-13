// frontend/src/app/producto/producto-dialog/producto-dialog.component.ts
import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormControl } from '@angular/forms';
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
import { NgxChartsModule } from '@swimlane/ngx-charts';

import { ProductoService } from '../../services/producto.service';
import { Producto, CreateProductoDto, UpdateProductoDto } from '../producto.interface';
import { CategoriaService } from '../../services/categoria.service';
import { Categoria } from '../../categoria/categoria.interface';
import { CatalogosService, Unidad, ObjetoImpuesto, ClaveProdServ, ClaveUnidad } from '../../services/catalogos.service';

import { Observable, of } from 'rxjs';
import { debounceTime, switchMap, startWith, map } from 'rxjs/operators';

@Component({
  selector: 'app-producto-dialog',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, MatDialogModule, MatFormFieldModule,
    MatInputModule, MatButtonModule, MatSelectModule, MatProgressSpinnerModule,
    MatAutocompleteModule, MatCheckboxModule, MatTabsModule, MatListModule, 
    MatIconModule, NgxChartsModule, MatSnackBarModule
  ],
  templateUrl: './producto-dialog.component.html',
})
export class ProductoDialogComponent implements OnInit {
  form: FormGroup;
  isEditMode: boolean;
  
  // Observables Catálogos
  public categoria$!: Observable<Categoria[]>;
  public unidades$!: Observable<Unidad[]>;
  public objetosImpuesto$!: Observable<ObjetoImpuesto[]>;
  public filteredClavesProdServ$!: Observable<ClaveProdServ[]>;
  public filteredClavesUnidad$!: Observable<ClaveUnidad[]>;

  // --- VARIABLES PARA PESTAÑAS AVANZADAS ---
  historialPrecios: any[] = [];
  equivalentes: any[] = [];
  
  // Para el buscador de Equivalentes
  buscadorEquivalenteControl = new FormControl('');
  productosCandidatos$: Observable<Producto[]> = of([]);
  listaTodosProductos: Producto[] = []; // Cargaremos aquí todos para filtrar localmente
  
  // Gráfica
  chartData: any[] = [];
  // Esquema de colores para la gráfica
  colorScheme: any = {
    domain: ['#5AA454', '#E44D25', '#CFC0BB', '#7aa3e5', '#a8385d', '#aae3f5']
  };
  
  constructor(
    private fb: FormBuilder,
    private productoService: ProductoService,
    private categoriaService: CategoriaService,
    private catalogosService: CatalogosService,
    private dialogRef: MatDialogRef<ProductoDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: Producto,
    private snackBar: MatSnackBar
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
      aplicaRetencionIva: [false]  
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
      switchMap(value => {
        const nombre = typeof value === 'string' ? value : value?.descripcion;
        return nombre ? this.catalogosService.buscarClaveProdServ(nombre) : of([]);
      })
    );

    this.filteredClavesUnidad$ = this.form.get('claveUnidadControl')!.valueChanges.pipe(
      startWith(''),
      debounceTime(300),
      switchMap(value => {
        const nombre = typeof value === 'string' ? value : value?.descripcion;
        return nombre ? this.catalogosService.buscarClaveUnidad(nombre) : of([]);
      })
    );

    // 3. Si es edición, cargar datos extra
    if (this.isEditMode && this.data) {
      this.form.patchValue(this.data);

      // Prellenado visual SAT
      if (this.data.idClaveProdOServ) {
        this.form.get('claveProdServControl')?.setValue({
          idClaveProdOServ: this.data.idClaveProdOServ,
          clave: this.data.claveProdServ,
          descripcion: this.data.descripcionProdServ
        });
      }
      if (this.data.idClaveUnidad) {
        this.form.get('claveUnidadControl')?.setValue({
          idClaveUnidad: this.data.idClaveUnidad,
          clave: this.data.claveUnidadSat,
          descripcion: this.data.descripcionUnidadSat
        });
      }

      // Cargar pestañas avanzadas
      this.cargarHistorialPrecios();
      this.cargarEquivalentes();
      
      // Cargar TODOS los productos para poder buscar equivalentes
      this.productoService.getProductos().subscribe(prods => {
        console.log('Raw data:', prods); 
        
        // --- CORRECCIÓN: MAPEO MANUAL DE MAYÚSCULAS A MINÚSCULAS ---
        this.listaTodosProductos = prods.map((p: any) => ({
          idProducto: p.IdProducto,
          codigo: p.Codigo,
          descripcion: p.Descripcion,
          precioUnitario: p.PrecioUnitario,
          existencia: p.Existencia
          // Solo necesitamos estos campos para el buscador visual
        })) as Producto[]; 
        
        this.configurarBuscadorEquivalentes();
        
        console.log('Productos mapeados (listos para buscar):', this.listaTodosProductos);
      }, error => {
        console.error('Error al cargar lista de productos:', error);
      });
    }
  }

  // --- LÓGICA EQUIVALENTES ---

  configurarBuscadorEquivalentes() {
    this.productosCandidatos$ = this.buscadorEquivalenteControl.valueChanges.pipe(
      startWith(''),
      map(valor => {
        // CORRECCIÓN:
        // Usamos 'as unknown as Producto' para calmar a TypeScript
        // O añadimos '|| ''' para manejar el caso de que sea null/undefined
        const termino = typeof valor === 'string' 
          ? valor 
          : (valor as unknown as Producto)?.descripcion || ''; 

        return termino ? this._filtrarProductos(termino) : [];
      })
    );
  }

  private _filtrarProductos(termino: string): Producto[] {
    const filterValue = termino.toLowerCase();
    
    return this.listaTodosProductos.filter(p => {
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
      error: (err) => this.mostrarNotificacion('Error: ' + err.message)
    });
  }

  desvincularEquivalente(idEq: number) {
    if(!confirm('¿Desvincular este producto?')) return;

    this.productoService.eliminarEquivalente(this.data.idProducto, idEq).subscribe(() => {
      this.cargarEquivalentes();
    });
  }

  cargarEquivalentes() {
    this.productoService.getEquivalentes(this.data.idProducto).subscribe(res => {
      this.equivalentes = res;
    });
  }

  // --- LÓGICA HISTORIAL ---

  cargarHistorialPrecios() {
    this.productoService.getHistorialPrecios(this.data.idProducto).subscribe(data => {
      if (data.length > 0) {
        this.chartData = [
          {
            name: 'Precio',
            series: data.map(h => ({
              name: new Date(h.fecha).toLocaleDateString(),
              value: Number(h.precio) // <--- Asegúrate que tenga Number() aquí también
            }))
          }
        ];
      }
    });
  }

  // --- UTILIDADES ---

  displayClave(item: any): string { return item ? `${item.clave} - ${item.descripcion}` : ''; }
  
  displayProdSimple(prod: Producto): string { return prod ? prod.descripcion : ''; }

  mostrarNotificacion(mensaje: string) { this.snackBar.open(mensaje, 'Cerrar', { duration: 3000 }); }
  cerrar() { this.dialogRef.close(); }

  guardar(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const formData = this.form.getRawValue();

    const idClaveProdOServ = (formData.claveProdServControl?.idClaveProdOServ) 
        ? formData.claveProdServControl.idClaveProdOServ : this.data?.idClaveProdOServ;

    const idClaveUnidad = (formData.claveUnidadControl?.idClaveUnidad)
        ? formData.claveUnidadControl.idClaveUnidad : this.data?.idClaveUnidad;

    const dataToSave = {
        ...formData,
        precioUnitario: Number(formData.precioUnitario),
        tasaIva: Number(formData.tasaIva),
        idClaveProdOServ, idClaveUnidad,
        claveProdServControl: undefined, claveUnidadControl: undefined
    };

    let request = this.isEditMode 
      ? this.productoService.updateProducto(this.data.idProducto, dataToSave)
      : this.productoService.createProducto(dataToSave);

    request.subscribe({
      next: () => {
        this.mostrarNotificacion(this.isEditMode ? 'Actualizado' : 'Creado');
        this.dialogRef.close(true);
      },
      error: (err) => this.mostrarNotificacion('Error: ' + err.message)
    });
  }
}