import { MatSelectModule } from '@angular/material/select';
// frontend/src/app/venta/factura-list/factura-list.component.ts
import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import anime from 'animejs';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
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
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { RemoteDirectory } from '../../shared/remote-directory';
import { localDate } from '../../shared/document-download';


@Component({
  selector: 'app-factura-list',
  standalone: true,
  imports: [
    CommonModule, MatTableModule, MatPaginatorModule, MatSortModule,
    MatCardModule, MatFormFieldModule, MatInputModule, MatIconModule,
    MatButtonModule, MatChipsModule, MatDialogModule, MatSnackBarModule,
    MatButtonToggleModule, FormsModule, MatSelectModule
  ],
  templateUrl: './factura-list.component.html',
  styles: [`
    .full-width { width: 100%; }
    .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
  `]
})
export class FacturaListComponent implements OnInit, OnDestroy {
  
  displayedColumns: string[] = ['folio', 'fecha', 'receptor', 'rfc', 'total', 'estatus', 'fiscal', 'acciones'];
  readonly directory: RemoteDirectory<FacturaResumen>;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  get dataSource() { return this.directory.dataSource; }
  get totalItems() { return this.directory.total(); }

  constructor(private ventaService: VentaService,
              public dialog: MatDialog,
              private snackBar: MatSnackBar,

  ) {
    this.directory = new RemoteDirectory(query => this.ventaService.getFacturas(query.page, query.limit, query.term, query.tipo || '', query.sortBy, query.sortOrder, query.estado || '', query.desde || '', query.hasta || ''),
      message => this.snackBar.open(message, 'Cerrar', { duration: 5000 }), ['folio', 'fecha', 'receptor', 'rfc', 'total', 'estatus']);
  }

  ngOnInit(): void {
    this.directory.connectUrl(this.route, this.router, true);
    this.directory.start();
  }
  ngOnDestroy(): void { this.directory.dispose(); }
  cargarFacturas(): void { this.directory.reload(); }
  applyFilter(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.directory.setTerm(event.target.value);
  }
  exportar(): void { this.directory.export(query => this.ventaService.exportCsv(query, query.tipo || ''), 'facturas_' + localDate() + '.csv'); }

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

  prepararCorreoLocal(row: FacturaResumen) {
    void this.router.navigate(['/facturas/correos'],{queryParams:{factura:row.id_factura}});
  }

  animarEntradaTabla() {
    anime({ targets: '.mat-mdc-row', translateY: [20, 0], opacity: [0, 1], delay: anime.stagger(50), duration: 400, easing: 'easeOutCubic' });
  }
}
