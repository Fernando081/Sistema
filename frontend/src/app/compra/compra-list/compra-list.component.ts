import { MatSelectModule } from '@angular/material/select';
// frontend/src/app/compra/compra-list/compra-list.component.ts
import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { RemoteDirectory } from '../../shared/remote-directory';
import { localDate } from '../../shared/document-download';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { CompraService } from '../../services/compra.service';
import { CompraResumen } from '../compra.interface';
import { CompraDetalleComponent } from '../compra-detalle/compra-detalle.component';

@Component({
  selector: 'app-compra-list',
  standalone: true,
  imports: [MatSelectModule,
    CommonModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatButtonModule,
    MatDialogModule, MatSnackBarModule,
  ],
  templateUrl: './compra-list.component.html',
})
export class CompraListComponent implements OnInit, OnDestroy {
  displayedColumns: string[] = ['fecha', 'proveedor', 'folio', 'total', 'acciones'];
  readonly directory: RemoteDirectory<CompraResumen>;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  get dataSource() { return this.directory.dataSource; }
  get totalItems() { return this.directory.total(); }
  get isLoading() { return this.directory.loading(); }

  constructor(
    private compraService: CompraService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
  ) {
    this.directory = new RemoteDirectory(query => this.compraService.getCompras(query.page, query.limit, query.term, this.compraService.sortKey(query.sortBy), query.sortOrder, query.estado || '', query.desde || '', query.hasta || ''),
      message => this.snackBar.open(message, 'Cerrar', { duration: 5000 }), ['fecha', 'cliente', 'folio', 'total']);
  }

  ngOnInit(): void {
    this.directory.connectUrl(this.route, this.router, false, ['Pendiente', 'Completada', 'Pagada']);
    this.directory.start();
  }
  ngOnDestroy(): void { this.directory.dispose(); }
  load(): void { this.directory.reload(); }
  applyFilter(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.directory.setTerm(event.target.value);
  }
  exportar(): void {
    this.directory.export(query => this.compraService.exportCsv(query), 'compras_' + localDate() + '.csv');
  }

  verDetalle(compra: CompraResumen) {
    this.dialog.open(CompraDetalleComponent, { width: '600px', data: compra });
  }
}
