import { Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { VentaService } from '../../services/venta.service';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

export interface DevolucionResumen {
  id_devolucion: number;
  id_factura: number;
  folio_factura: string;
  fecha: string;
  monto_total: number;
  metodo_reembolso: string;
  cliente: string;
  rfc: string;
}

@Component({
  selector: 'app-devolucion-list',
  standalone: true,
  imports: [
    CommonModule, MatTableModule, MatPaginatorModule, MatSortModule,
    MatCardModule, MatFormFieldModule, MatInputModule, MatIconModule,
    MatButtonModule, MatProgressSpinnerModule, MatSnackBarModule, MatTooltipModule
  ],
  templateUrl: './devolucion-list.html',
  styleUrl: './devolucion-list.css',
})
export class DevolucionList implements OnInit {
  displayedColumns: string[] = ['folio_nc', 'folio_factura', 'fecha', 'cliente', 'metodo_reembolso', 'monto_total', 'acciones'];
  dataSource = new MatTableDataSource<DevolucionResumen>();
  isLoading = true;

  totalRegistros = 0;
  pageSize = 10;
  currentPage = 1;
  searchTerm = '';

  private searchSubject = new Subject<string>();

  @ViewChild(MatPaginator) paginator!: MatPaginator;

  constructor(
    private ventaService: VentaService,
    private snackBar: MatSnackBar
  ) {
    this.searchSubject.pipe(
      debounceTime(400),
      distinctUntilChanged()
    ).subscribe(term => {
      this.searchTerm = term;
      this.currentPage = 1; // Reset to first page
      this.cargarDevoluciones();
    });
  }

  ngOnInit(): void {
    this.cargarDevoluciones();
  }

  cargarDevoluciones() {
    this.isLoading = true;
    this.ventaService.getDevoluciones(this.currentPage, this.pageSize, this.searchTerm).subscribe({
      next: (res) => {
        this.dataSource.data = res.data;
        this.totalRegistros = res.total;
        this.isLoading = false;
      },
      error: (err) => {
        console.error(err);
        this.isLoading = false;
        this.snackBar.open('Error al cargar historial de Notas de Crédito', 'Cerrar', { duration: 3000 });
      }
    });
  }

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.searchSubject.next(filterValue.trim());
  }

  onPageChange(event: PageEvent) {
    this.currentPage = event.pageIndex + 1;
    this.pageSize = event.pageSize;
    this.cargarDevoluciones();
  }

  descargarCFDI(idDevolucion: number) {
    this.snackBar.open('Generando documento CFDI...', 'Ok', { duration: 2000 });
    this.ventaService.descargarPdfDevolucion(idDevolucion).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        window.open(url);
      },
      error: () => this.snackBar.open('Error descargando el CFDI', 'Cerrar', { duration: 3000 })
    });
  }
}
