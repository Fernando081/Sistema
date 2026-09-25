// frontend/src/app/cotizacion/cotizacion-list/cotizacion-list.component.ts
import { Component, OnInit, ViewChild, AfterViewInit, OnDestroy, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { downloadDocument } from '../../shared/document-download';
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
import { forkJoin, Subject, Subscription, debounceTime, distinctUntilChanged } from 'rxjs';
import { CotizacionService } from '../../services/cotizacion.service';
import { CatalogosService } from '../../services/catalogos.service';
import { ConvertirDialogComponent } from './convertir-dialog.component';
import { Router, RouterLink } from '@angular/router';
import { PedidoService } from '../../services/pedido.service';

@Component({
  selector: 'app-cotizacion-list',
  standalone: true,
  imports: [
    CommonModule, MatTableModule, MatPaginatorModule, MatSortModule,
    MatCardModule, MatFormFieldModule, MatInputModule, MatIconModule,
    MatButtonModule, MatSnackBarModule, MatTooltipModule,
    MatDialogModule, RouterLink
  ],
  templateUrl: './cotizacion-list.component.html',
})
export class CotizacionListComponent implements OnInit, AfterViewInit, OnDestroy {
  
  displayedColumns: string[] = ['folio', 'fecha', 'cliente', 'total', 'estatus', 'acciones'];
  dataSource = new MatTableDataSource<any>();
  totalItems = 0;
  activeFilter = '';
  searchSubject = new Subject<string>();
  private readonly destroyRef = inject(DestroyRef);
  private request?: Subscription;

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  constructor(
    private cotizacionService: CotizacionService,
    private catalogosService: CatalogosService,
    private snackBar: MatSnackBar,
    private dialog: MatDialog,
    private pedidoService: PedidoService,
    private router: Router,
  ) {}

  crearPedido(row: any) {
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
    this.cargarCotizaciones();

    this.searchSubject.pipe(
      debounceTime(400),
      distinctUntilChanged(), takeUntilDestroyed(this.destroyRef)
    ).subscribe(term => {
      this.activeFilter = term;
      if (this.paginator) {
        this.paginator.pageIndex = 0;
      }
      this.cargarCotizaciones();
    });
  }

  ngOnDestroy(): void {
    this.searchSubject.complete();
    this.request?.unsubscribe();
  }

  ngAfterViewInit(): void {
    // Escuchar el paginador para recargar
    if(this.paginator) {
      this.paginator.page.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
        this.cargarCotizaciones();
      });
    }
  }

  cargarCotizaciones() {
    this.request?.unsubscribe();
    const page = this.paginator ? this.paginator.pageIndex + 1 : 1;
    const limit = this.paginator ? this.paginator.pageSize : 10;
    
    this.request = this.cotizacionService.getAll(page, limit, this.activeFilter).subscribe({
      next: (response) => {
        const data = response.data || response;
        this.totalItems = response.total || 0;
        this.dataSource.data = data;
      },
      error: (e) => console.error(e)
    });
  }

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.searchSubject.next(filterValue.trim().toLowerCase());
  }

  descargarPdf(id: number) {
    this.cotizacionService.descargarPdf(id).subscribe(blob => {
      downloadDocument(blob, `Cotizacion_${id}.pdf`);
    });
  }

  // --- LA FUNCIÓN MODIFICADA PARA CRM B2B ---
  convertir(row: any) {
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
      error: (err) => {
        this.snackBar.open('Error cargando catálogos de pago.', 'Cerrar');
      }
    });
  }
}
