// frontend/src/app/producto/producto-list/producto-list.component.ts (MODIFICAR)

import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { productImageUrl } from '../../shared/api-url';
import anime from 'animejs';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ProductoService } from '../../services/producto.service';
import { Producto } from '../producto.interface';
import { ProductoDialogComponent } from '../producto-dialog/producto-dialog.component';
import { RemoteDirectory } from '../../shared/remote-directory';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs'; // 1. Importar MatTabsModule
import { CategoriaListComponent } from '../../categoria/categoria-list/categoria-list.component'; // 2. Importar CategoriaListComponent
import { ProductoKardexComponent } from '../producto-kardex/producto-kardex.component';
import { ProductoCotizacionesDialogComponent } from './producto-cotizaciones-dialog.component';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { localDate } from '../../shared/document-download';
import { ConfirmService } from '../../shared/confirm.service';
import { SavedViewsComponent } from '../../shared/saved-views.component';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { BulkSelection } from '../../shared/bulk-selection';
import { ProductoLoteDialogComponent, ProductoLoteDialogData } from './producto-lote-dialog.component';

@Component({
  selector: 'app-producto-list',
  standalone: true,
  imports: [SavedViewsComponent, 
    CommonModule, MatTableModule, MatPaginatorModule, MatSortModule,
    MatFormFieldModule, MatInputModule, MatIconModule,
    MatButtonModule, MatDialogModule, MatSnackBarModule, MatTooltipModule,
    MatProgressSpinnerModule, CurrencyPipe,
    MatTabsModule,
    CategoriaListComponent, RouterLink, MatCheckboxModule
  ],
  templateUrl: './producto-list.component.html',
  styleUrls: ['../../shared/list-page.css', './producto-list.component.css']
})
export class ProductoListComponent implements OnInit, OnDestroy {
  readonly canEdit = inject(AuthService).getSessionIdentity()?.role === 'admin';
  readonly productImageUrl = productImageUrl;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  
  /** U02.3 · Productos marcados para cambiar precio o categoría en lote (sólo administradores). */
  readonly seleccion = new BulkSelection<Producto>((row) => row.idProducto, 200);
  displayedColumns: string[] = [...(this.canEdit ? ['seleccion'] : []), 'imagen_url', 'codigo', 'descripcion', 'categoriaNombre', 'marca', 'ubicacion', 'precioUnitario','existencia', 'acciones'];
  readonly directory: RemoteDirectory<Producto>;
  get dataSource() { return this.directory.dataSource; }
  get isLoading() { return this.directory.loading(); }
  get totalItems() { return this.directory.total(); }
  get isExporting() { return this.directory.exporting(); }

  constructor(
    private productoService: ProductoService,
    public dialog: MatDialog,
    private snackBar: MatSnackBar,
    private confirm: ConfirmService,
  ) {
    this.directory = new RemoteDirectory(query => this.productoService.getProductos(query.page, query.limit, query.sortBy === 'id' ? '' : query.sortBy, query.sortOrder, query.term),
      message => this.mostrarNotificacion(message), ['codigo', 'descripcion', 'categoriaNombre', 'marca', 'ubicacion', 'precioUnitario', 'existencia']);
  }

  ngOnInit(): void {
    this.directory.connectUrl(this.route, this.router);
    this.directory.start();
  }
  ngOnDestroy(): void { this.directory.dispose(); }
  cargarProductos(): void { this.directory.reload(); }

  cambiarEnLote(accion: ProductoLoteDialogData['accion']): void {
    const ids = this.seleccion.ids();
    if (!ids.length) return;
    this.dialog.open(ProductoLoteDialogComponent, { width: '760px', maxWidth: '96vw', data: { accion, ids } })
      .afterClosed().subscribe((result) => {
        if (!result) return;
        this.mostrarNotificacion(result.message);
        this.seleccion.clear();
        this.directory.reload();
      });
  }

  verKardex(producto: Producto) {
    this.dialog.open(ProductoKardexComponent, {
      width: '880px',
      maxWidth: '96vw',
      data: producto
    });
  }

  verCotizacionesProveedor(producto: Producto) {
    this.dialog.open(ProductoCotizacionesDialogComponent, {
      width: '1500px',
      maxWidth: '95vw',
      data: {
        idProducto: producto.idProducto,
        productoNombre: producto.descripcion
      }
    });
  }

  applyFilter(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.directory.setTerm(event.target.value);
  }
  exportar(): void {
    this.directory.export(query => this.productoService.exportCsv(query.term, query.sortBy === 'id' ? '' : query.sortBy, query.sortOrder), 'productos_' + localDate() + '.csv');
  }

  onImageError(event: Event) {
    const image = event.currentTarget as HTMLImageElement;
    image.hidden = true;
    (image.nextElementSibling as HTMLElement | null)?.removeAttribute('hidden');
  }

  abrirDialogo(producto?: Producto): void {
    // ... (esta función no cambia)
    const dialogRef = this.dialog.open(ProductoDialogComponent, {
      width: '600px',
      data: producto ? {...producto} : null 
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.cargarProductos();
      }
    });
  }

  eliminarProducto(idProducto: number): void {
    this.confirm.ask({ title: 'Eliminar producto', message: 'Se eliminará la ficha si el producto no tiene movimientos que deban conservarse.', confirmLabel: 'Eliminar producto' }).subscribe(confirmed => {
      if (!confirmed) return;
      this.productoService.deleteProducto(idProducto).subscribe({
        next: () => {
          this.mostrarNotificacion('Producto eliminado con éxito');
          this.cargarProductos();
        },
        error: (err) => {
          this.mostrarNotificacion('Error al eliminar producto: ' + (err.error?.message || err.message));
        }
      });
    });
  }

  mostrarNotificacion(mensaje: string) {
    // ... (esta función no cambia)
    this.snackBar.open(mensaje, 'Cerrar', { duration: 3000 });
  }

  animarEntradaTabla() {
    anime({ targets: '.mat-mdc-row', translateY: [20, 0], opacity: [0, 1], delay: anime.stagger(50), duration: 400, easing: 'easeOutCubic' });
  }
}
