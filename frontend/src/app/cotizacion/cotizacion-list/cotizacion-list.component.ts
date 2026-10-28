import { MatSelectModule } from '@angular/material/select';
import { CotizacionResumen } from '../../services/cotizacion-api.types';
// frontend/src/app/cotizacion/cotizacion-list/cotizacion-list.component.ts
import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { RemoteDirectory } from '../../shared/remote-directory';
import { downloadDocument, localDate } from '../../shared/document-download';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PedidoService } from '../../services/pedido.service';
import { SavedViewsComponent } from '../../shared/saved-views.component';

@Component({
  selector: 'app-cotizacion-list',
  standalone: true,
  imports: [SavedViewsComponent, MatSelectModule,
    CommonModule, MatTableModule, MatPaginatorModule, MatSortModule,
    MatCardModule, MatFormFieldModule, MatInputModule, MatIconModule,
    MatButtonModule, MatSnackBarModule, MatTooltipModule,
    MatDialogModule, RouterLink
  ],
  templateUrl: './cotizacion-list.component.html',
  styleUrls: ['../../shared/list-page.css'],
})
export class CotizacionListComponent implements OnInit, OnDestroy {
  
  displayedColumns: string[] = ['folio', 'fecha', 'cliente', 'total', 'estatus', 'acciones'];
  readonly directory: RemoteDirectory<CotizacionResumen>;
  private readonly route = inject(ActivatedRoute);
  get dataSource() { return this.directory.dataSource; }
  get totalItems() { return this.directory.total(); }

  constructor(
    private cotizacionService: CotizacionService,
    private catalogosService: CatalogosService,
    private snackBar: MatSnackBar,
    private dialog: MatDialog,
    private pedidoService: PedidoService,
    private router: Router,
  ) {
    this.directory = new RemoteDirectory(query => this.cotizacionService.getAll(query.page, query.limit, query.term, query.sortBy, query.sortOrder, query.estado || '', query.desde || '', query.hasta || ''),
      message => this.snackBar.open(message, 'Cerrar', { duration: 5000 }), ['folio', 'fecha', 'cliente', 'total', 'estatus']);
  }

  crearPedido(row: CotizacionResumen) {
    this.pedidoService.createFromQuote(row.id_cotizacion, { requestId: crypto.randomUUID() }).subscribe({
      next: ({ idPedido }) => {
        this.snackBar.open(`Pedido PED-${idPedido} creado desde la cotización.`, 'Abrir', { duration: 6000 })
          .onAction().subscribe(() => this.router.navigate(['/pedidos']));
        this.cargarCotizaciones();
      },
      error: (err) => this.snackBar.open('No se pudo crear el pedido: ' + (err.error?.message || err.message), 'Cerrar', { duration: 5000 }),
    });
  }

  ngOnInit(): void {
    this.directory.connectUrl(this.route, this.router, false, ['Vigente', 'Pendiente', 'Convertida', 'Rechazada']);
    this.directory.start();
  }
  ngOnDestroy(): void { this.directory.dispose(); }
  cargarCotizaciones(): void { this.directory.reload(); }
  applyFilter(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.directory.setTerm(event.target.value);
  }
  exportar(): void {
    this.directory.export(query => this.cotizacionService.exportCsv(query), 'cotizaciones_' + localDate() + '.csv');
  }

  descargarPdf(id: number) {
    this.cotizacionService.descargarPdf(id).subscribe(blob => {
      downloadDocument(blob, `Cotizacion_${id}.pdf`);
    });
  }

  // --- LA FUNCIÓN MODIFICADA PARA CRM B2B ---
  convertir(row: CotizacionResumen) {
    forkJoin({
      formasPago: this.catalogosService.getFormasPago(),
      metodosPago: this.catalogosService.getMetodosPago()
    }).subscribe({
      next: (cats) => {
        const dialogRef = this.dialog.open(ConvertirDialogComponent, {
          width: '1100px', 
          maxWidth: '95vw',
          disableClose: true,
          data: {
            idCotizacion: row.id_cotizacion,
            folio: row.folio,
            formasPago: cats.formasPago,
            metodosPago: cats.metodosPago
          }
        });

        dialogRef.afterClosed().subscribe(payload => {
          if (payload) { // The dialog returns the strict ConvertirCotizacionDto JSON shape
            this.cotizacionService.convertirCRM(row.id_cotizacion, payload).subscribe({
              next: (apiRes) => {
                this.snackBar.open(`¡Factura generada y rastreo CRM asignado! (ID: ${apiRes.idFactura})`, 'Cerrar', { duration: 6000 });
                this.cargarCotizaciones();
              },
              error: (err) => {
                this.snackBar.open('Error al convertir: ' + (err.error?.message || err.message), 'Cerrar', { duration: 5000 });
              }
            });
          }
        });
      },
      error: () => {
        this.snackBar.open('Error cargando catálogos de pago.', 'Cerrar');
      }
    });
  }
}
