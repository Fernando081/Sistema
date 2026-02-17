// frontend/src/app/categoria/categoria-list/categoria-list.component.ts (REEMPLAZAR)

import { Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
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
import { CategoriaService } from '../../services/categoria.service';
import { Categoria } from '../categoria.interface';
import { CategoriaDialogComponent } from '../categoria-dialog/categoria-dialog.component';
import { finalize } from 'rxjs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
  selector: 'app-categoria-list', // Este es el selector que usaremos
  standalone: true,
  imports: [
    CommonModule, MatTableModule, MatPaginatorModule, MatSortModule,
    MatCardModule, MatFormFieldModule, MatInputModule, MatIconModule,
    MatButtonModule, MatDialogModule, MatSnackBarModule, MatTooltipModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './categoria-list.component.html',
  styleUrls: ['./categoria-list.component.css']
})
export class CategoriaListComponent implements OnInit {
  
  displayedColumns: string[] = ['idCategoria', 'descripcion', 'acciones'];
  dataSource = new MatTableDataSource<Categoria>();
  isLoading = true;

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  constructor(
    private categoriaService: CategoriaService,
    public dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.cargarCategorias();
  }

  cargarCategorias(): void {
    this.isLoading = true;
    this.categoriaService.getCategorias()
      .pipe(finalize(() => this.isLoading = false))
      .subscribe({
        next: (data) => {
          this.dataSource.data = data;
          this.dataSource.paginator = this.paginator;
          this.dataSource.sort = this.sort;
        },
        error: (err) => {
          this.mostrarNotificacion('Error al cargar categorías: ' + (err.error?.message || err.message));
        }
      });
  }

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSource.filter = filterValue.trim().toLowerCase();
    
    if (this.dataSource.paginator) {
      this.dataSource.paginator.firstPage();
    }
  }

  abrirDialogo(categoria?: Categoria): void {
    const dialogRef = this.dialog.open(CategoriaDialogComponent, {
      width: '400px', // Un diálogo más pequeño
      data: categoria ? {...categoria} : null 
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.cargarCategorias();
      }
    });
  }

  eliminarCategoria(idCategoria: number): void {
    if (confirm('¿Estás seguro de que deseas eliminar esta categoría?')) {
      this.categoriaService.deleteCategoria(idCategoria).subscribe({
        next: () => {
          this.mostrarNotificacion('Categoría eliminada con éxito');
          this.cargarCategorias();
        },
        error: (err) => {
          this.mostrarNotificacion('Error al eliminar categoría: ' + (err.error?.message || err.message));
        }
      });
    }
  }

  mostrarNotificacion(mensaje: string) {
    this.snackBar.open(mensaje, 'Cerrar', { duration: 3000 });
  }
}