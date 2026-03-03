// frontend/src/app/venta/factura-list/factura-list.component.ts
import { Component, OnInit, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips'; // Para que el estatus se vea bonito
import { VentaService } from '../../services/venta.service';
import { FacturaResumen } from '../venta.interface';
import { MatDialog, MatDialogModule } from '@angular/material/dialog'; // Importar Dialog
import { FacturaDetalleComponent } from '../factura-detalle/factura-detalle.component'; // Importar Componente
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';


@Component({
  selector: 'app-factura-list',
  standalone: true,
  imports: [
    CommonModule, MatTableModule, MatPaginatorModule, MatSortModule,
    MatCardModule, MatFormFieldModule, MatInputModule, MatIconModule,
    MatButtonModule, MatChipsModule, MatDialogModule, MatSnackBarModule
  ],
  templateUrl: './factura-list.component.html',
  styles: [`
    .full-width { width: 100%; }
    .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
  `]
})
export class FacturaListComponent implements OnInit, AfterViewInit {
  
  displayedColumns: string[] = ['folio', 'fecha', 'receptor', 'rfc', 'total', 'estatus', 'acciones'];
  dataSource = new MatTableDataSource<FacturaResumen>();
  totalItems = 0;

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  constructor(private ventaService: VentaService,
              public dialog: MatDialog,
              private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.cargarFacturas();
  }

  ngAfterViewInit(): void {
    this.paginator.page.subscribe(() => {
      this.cargarFacturas();
    });
  }

  cargarFacturas() {
    const page = this.paginator ? this.paginator.pageIndex + 1 : 1;
    const limit = this.paginator ? this.paginator.pageSize : 10;
    
    this.ventaService.getFacturas(page, limit).subscribe({
      next: (response) => {
        const data = response.data || response;
        this.totalItems = response.total || 0;
        this.dataSource.data = data;
        // this.dataSource.paginator = this.paginator;
        // this.dataSource.sort = this.sort;
      },
      error: (err) => console.error('Error cargando facturas', err)
    });
  }

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSource.filter = filterValue.trim().toLowerCase();

    if (this.paginator) {
      this.paginator.firstPage();
    }
  }

  // Función auxiliar para el color del chip de estatus
  getColorEstatus(estatus: string): string {
    switch (estatus) {
      case 'Pagada': return 'accent'; // Verde/Rosa dependiendo del tema
      case 'Timbrada': return 'primary';
      case 'Cancelada': return 'warn'; // Rojo
      default: return ''; // Gris (Pendiente)
    }
  }

  // --- FUNCIÓN PARA ABRIR EL DIÁLOGO ---
  verDetalle(factura: FacturaResumen) {
    this.dialog.open(FacturaDetalleComponent, {
      width: '800px',
      data: factura // Le pasamos toda la fila seleccionada
    });
  }

  enviarPorCorreo(row: FacturaResumen) {
    if (!confirm(`¿Enviar factura A${row.folio} al cliente por correo?`)) return;
    
    this.ventaService.enviarCorreo(row.id_factura).subscribe({
      next: () => this.snackBar.open('📧 Correo enviado correctamente', 'Ok', { duration: 4000 }),
      error: (err) => this.snackBar.open('Error: ' + (err.error?.message || err.message), 'Ok')
    });
  }
}