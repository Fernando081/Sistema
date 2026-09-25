// frontend/src/app/compra/compra-list/compra-list.component.ts
import { Component, OnInit, ViewChild, AfterViewInit, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, Subscription, debounceTime, distinctUntilChanged, finalize } from 'rxjs';
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
import { CompraService } from '../../services/compra.service';
import { CompraResumen } from '../compra.interface';
import { CompraDetalleComponent } from '../compra-detalle/compra-detalle.component';

@Component({
  selector: 'app-compra-list',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatButtonModule,
    MatDialogModule,
  ],
  templateUrl: './compra-list.component.html',
})
export class CompraListComponent implements OnInit, AfterViewInit {
  displayedColumns: string[] = ['fecha', 'proveedor', 'folio', 'total', 'acciones'];
  dataSource = new MatTableDataSource<CompraResumen>();
  totalItems = 0;
  isLoading = false;
  private readonly destroyRef = inject(DestroyRef);
  private readonly search = new Subject<string>();
  private request?: Subscription;
  private term = '';

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  constructor(
    private compraService: CompraService,
    private dialog: MatDialog,
  ) {}

  ngOnInit(): void {
    this.load();
    this.search.pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef)).subscribe(term => {
      this.term = term;
      this.paginator.pageIndex = 0;
      this.load();
    });
    this.destroyRef.onDestroy(() => this.request?.unsubscribe());
  }

  ngAfterViewInit(): void {
    this.paginator.page.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.load());
    this.sort.sortChange.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => { this.paginator.pageIndex = 0; this.load(); });
  }

  load(): void {
    this.request?.unsubscribe();
    this.isLoading = true;
    const columns: Record<string, string> = { fecha: 'fecha_compra', proveedor: 'nombre_proveedor', folio: 'folio_factura', total: 'total' };
    this.request = this.compraService.getCompras((this.paginator?.pageIndex ?? 0) + 1, this.paginator?.pageSize || 10, this.term, columns[this.sort?.active] || '', this.sort?.direction || '')
      .pipe(finalize(() => this.isLoading = false)).subscribe({
        next: response => { this.dataSource.data = response.data; this.totalItems = response.total; },
        error: () => { this.dataSource.data = []; this.totalItems = 0; },
      });
  }

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.search.next(filterValue.trim());
  }

  verDetalle(compra: CompraResumen) {
    this.dialog.open(CompraDetalleComponent, { width: '600px', data: compra });
  }
}
