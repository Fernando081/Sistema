// frontend/src/app/producto/producto-list/producto-list.component.ts (MODIFICAR)

import { Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatCardModule } from '@angular/material/card';
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
import { finalize } from 'rxjs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs'; // 1. Importar MatTabsModule
import { CategoriaListComponent } from '../../categoria/categoria-list/categoria-list.component'; // 2. Importar CategoriaListComponent
import { ProductoKardexComponent } from '../producto-kardex/producto-kardex.component';

@Component({
  selector: 'app-producto-list',
  standalone: true,
  imports: [
    CommonModule, MatTableModule, MatPaginatorModule, MatSortModule,
    MatCardModule, MatFormFieldModule, MatInputModule, MatIconModule,
    MatButtonModule, MatDialogModule, MatSnackBarModule, MatTooltipModule,
    MatProgressSpinnerModule, CurrencyPipe,
    MatTabsModule,
    CategoriaListComponent
  ],
  templateUrl: './producto-list.component.html',
  styleUrls: ['./producto-list.component.css']
})
export class ProductoListComponent implements OnInit {
  
  displayedColumns: string[] = ['idProducto', 'codigo', 'descripcion', 'categoriaNombre', 'precioUnitario','existencia', 'acciones'];
  dataSource = new MatTableDataSource<Producto>();
  isLoading = true;

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  constructor(
    private productoService: ProductoService,
    public dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.cargarProductos();
  }

  cargarProductos(): void {
    this.isLoading = true;
    this.productoService.getProductos()
      .pipe(finalize(() => this.isLoading = false))
      .subscribe({
        next: (data) => {
          // Mapeo limpio sin duplicados
          const camelCaseData: Producto[] = data.map(prod => ({
            idProducto: prod['IdProducto'],
            codigo: prod['Codigo'],
            idUnidad: prod['IdUnidad'],
            idObjetoImpuesto: prod['IdObjetoImpuesto'],
            descripcion: prod['Descripcion'],
            precioUnitario: prod['PrecioUnitario'],
            idCategoria: prod['IdCategoria'],
            ubicacion: prod['Ubicacion'],
            idClaveProdOServ: prod['IdClaveProdOServ'],
            idClaveUnidad: prod['IdClaveUnidad'],
            marca: prod['Marca'],
            
            // JOINS
            categoriaNombre: prod['CategoriaNombre'],
            claveProdServ: prod['ClaveProdServ'],
            descripcionProdServ: prod['DescripcionProdServ'],
            claveUnidadSat: prod['ClaveUnidadSat'],
            descripcionUnidadSat: prod['DescripcionUnidadSat'],
            
            // CAMPOS FISCALES
            objetoImpuestoSat: prod['ObjetoImpuesto'], 
            tasaIva: prod['TasaIVA'],
            aplicaRetencionIsr: prod['AplicaRetencionISR'],
            aplicaRetencionIva: prod['AplicaRetencionIVA'],

            // --- ¡ESTA ES LA LÍNEA QUE FALTABA! ---
            existencia: Number(prod['Existencia'] || 0)
          }));
          
          this.dataSource.data = camelCaseData;
          this.dataSource.paginator = this.paginator;
          this.dataSource.sort = this.sort;
        },
        error: (err) => {
          this.mostrarNotificacion('Error al cargar productos: ' + (err.error?.message || err.message));
        }
      });
  }

  verKardex(producto: Producto) {
    this.dialog.open(ProductoKardexComponent, {
      width: '600px',
      data: producto
    });
  }

  applyFilter(event: Event) {
    // ... (esta función no cambia)
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSource.filter = filterValue.trim().toLowerCase();
    
    this.dataSource.filterPredicate = (data: Producto, filter: string): boolean => {
      const descMatch = data.descripcion.toLowerCase().includes(filter);
      const codigoMatch = (data.codigo?.toLowerCase().includes(filter)) ?? false;
      const marcaMatch = (data.marca?.toLowerCase().includes(filter)) ?? false;
      return descMatch || codigoMatch || marcaMatch;
    };

    if (this.dataSource.paginator) {
      this.dataSource.paginator.firstPage();
    }
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
    // ... (esta función no cambia)
    if (confirm('¿Estás seguro de que deseas eliminar este producto?')) {
      this.productoService.deleteProducto(idProducto).subscribe({
        next: () => {
          this.mostrarNotificacion('Producto eliminado con éxito');
          this.cargarProductos();
        },
        error: (err) => {
          this.mostrarNotificacion('Error al eliminar producto: ' + (err.error?.message || err.message));
        }
      });
    }
  }

  mostrarNotificacion(mensaje: string) {
    // ... (esta función no cambia)
    this.snackBar.open(mensaje, 'Cerrar', { duration: 3000 });
  }
}