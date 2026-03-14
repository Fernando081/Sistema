// frontend/src/app/venta/factura-list/factura-list.component.ts
import { Component, OnInit, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';
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
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';


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
export class FacturaListComponent implements OnInit, AfterViewInit, OnDestroy {
  
  displayedColumns: string[] = ['folio', 'fecha', 'receptor', 'rfc', 'total', 'estatus', 'acciones'];
  dataSource = new MatTableDataSource<FacturaResumen>();
  totalItems = 0;
  activeFilter = '';
  searchSubject = new Subject<string>();

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  constructor(private ventaService: VentaService,
              public dialog: MatDialog,
              private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.cargarFacturas();

    this.searchSubject.pipe(
      debounceTime(400),
      distinctUntilChanged()
    ).subscribe(term => {
      this.activeFilter = term;
      if (this.paginator) {
        this.paginator.firstPage();
      }
      this.cargarFacturas();
    });
  }

  ngOnDestroy(): void {
    this.searchSubject.complete();
  }

  ngAfterViewInit(): void {
    this.paginator.page.subscribe(() => {
      this.cargarFacturas();
    });
  }

  cargarFacturas() {
    const page = this.paginator ? this.paginator.pageIndex + 1 : 1;
    const limit = this.paginator ? this.paginator.pageSize : 10;
    
    this.ventaService.getFacturas(page, limit, this.activeFilter).subscribe({
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
    this.searchSubject.next(filterValue.trim().toLowerCase());
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

  verDetalle(factura: FacturaResumen) {
    const dialogRef = this.dialog.open(FacturaDetalleComponent, {
      width: '800px',
      data: factura // Le pasamos toda la fila seleccionada
    });

    dialogRef.afterClosed().subscribe(() => {
      this.cargarFacturas(); // Recargar la tabla por si el estatus cambió a cancelado
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