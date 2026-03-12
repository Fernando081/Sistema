// frontend/src/app/cotizacion/cotizacion-list/cotizacion-list.component.ts
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
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { forkJoin } from 'rxjs';
import { CotizacionService } from '../../services/cotizacion.service';
import { CatalogosService } from '../../services/catalogos.service';
import { ConvertirDialogComponent } from './convertir-dialog.component';

@Component({
  selector: 'app-cotizacion-list',
  standalone: true,
  imports: [
    CommonModule, MatTableModule, MatPaginatorModule, MatSortModule,
    MatCardModule, MatFormFieldModule, MatInputModule, MatIconModule,
    MatButtonModule, MatSnackBarModule, MatTooltipModule,
    MatDialogModule
  ],
  templateUrl: './cotizacion-list.component.html',
})
export class CotizacionListComponent implements OnInit {
  
  displayedColumns: string[] = ['folio', 'fecha', 'cliente', 'total', 'estatus', 'acciones'];
  dataSource = new MatTableDataSource<any>();

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  constructor(
    private cotizacionService: CotizacionService,
    private catalogosService: CatalogosService,
    private snackBar: MatSnackBar,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.cargarCotizaciones();
  }

  cargarCotizaciones() {
    this.cotizacionService.getAll().subscribe({
      next: (data) => {
        this.dataSource.data = data;
        this.dataSource.paginator = this.paginator;
        this.dataSource.sort = this.sort;
      },
      error: (e) => console.error(e)
    });
  }

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSource.filter = filterValue.trim().toLowerCase();
  }

  descargarPdf(id: number) {
    this.cotizacionService.descargarPdf(id).subscribe(blob => {
      const url = window.URL.createObjectURL(blob);
      window.open(url);
    });
  }

  // --- LA FUNCIÓN MODIFICADA ---
  convertir(row: any) {
    // 1. Cargar catálogos
    forkJoin({
      formasPago: this.catalogosService.getFormasPago(),
      metodosPago: this.catalogosService.getMetodosPago()
    }).subscribe({
      next: (cats) => {
        // 2. Abrir el modal
        const dialogRef = this.dialog.open(ConvertirDialogComponent, {
          width: '500px',
          data: {
            folio: row.folio,
            formasPago: cats.formasPago,
            metodosPago: cats.metodosPago
          }
        });

        // 3. Suscribirse al cierre
        dialogRef.afterClosed().subscribe(res => {
          if (res && res.idFormaPago && res.idMetodoPago) {
            // Confirmación secundaria
            if (!confirm(`¿Estás seguro de efectuar la conversión?\nEsto descontará inventario y generará la factura de venta.`)) return;
            
            this.cotizacionService.convertirEnVenta(row.id_cotizacion, res.idFormaPago, res.idMetodoPago).subscribe({
              next: (apiRes) => {
                this.snackBar.open(`¡Éxito! Venta generada con ID: ${apiRes.idFactura}`, 'Cerrar', { duration: 5000 });
                this.cargarCotizaciones(); // Recargar para ver el estatus 'Convertida'
              },
              error: (err) => {
                this.snackBar.open('Error: ' + err.error.message, 'Cerrar');
              }
            });
          }
        });
      },
      error: (err) => {
        this.snackBar.open('Error cargando catálogos de pago.', 'Cerrar');
      }
    });
  }
}