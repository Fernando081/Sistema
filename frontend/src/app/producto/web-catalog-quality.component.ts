import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { environment } from '../../environments/environment';
import { WebProductEditorComponent } from './web-product-editor.component';
import { WebBatchEditorComponent } from './web-batch-editor.component';
interface QualityRow {
  id: number;
  codigo: string | null;
  nombre: string;
  marca: string | null;
  categoria: string | null;
  estado: string;
  pendientes: string[];
  duplicados: string;
}
interface CatalogPage {
  data: QualityRow[];
  total: number;
  page: number;
  limit: number;
}
@Component({
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, WebProductEditorComponent],
  template: `<h2 mat-dialog-title>Preparar ficha comercial</h2>
    <mat-dialog-content><app-web-product-editor [productId]="id" /></mat-dialog-content
    ><mat-dialog-actions
      ><button mat-stroked-button mat-dialog-close type="button">
        Cerrar editor
      </button></mat-dialog-actions
    >`,
})
export class CatalogEditorDialog {
  readonly id = inject<number>(MAT_DIALOG_DATA);
}
@Component({
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    RouterLink,
    WebBatchEditorComponent,
  ],
  templateUrl: './web-catalog-quality.component.html',
  styleUrl: './web-catalog-quality.component.css',
})
export class WebCatalogQualityComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);
  readonly rows = signal<QualityRow[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly total = signal(0);
  term = '';
  estado = 'todos';
  revision = 'todos';
  page = 1;
  readonly limit = 25;
  ngOnInit() {
    this.load();
  }
  search() {
    this.page = 1;
    this.load();
  }
  load() {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    const params = new HttpParams()
      .set('page', this.page)
      .set('limit', this.limit)
      .set('term', this.term.trim())
      .set('estado', this.estado)
      .set('revision', this.revision);
    this.http
      .get<CatalogPage>(`${environment.apiBaseUrl}/web-catalog/admin/products`, { params })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (response) => {
          this.rows.set(response.data);
          this.total.set(response.total);
        },
        error: () => {
          this.rows.set([]);
          this.total.set(0);
          this.error.set(
            'No se pudo cargar la revisión. Reintenta o revisa tu acceso administrativo.',
          );
        },
      });
  }
  next(delta: number) {
    this.page += delta;
    this.load();
  }
  edit(row: QualityRow) {
    this.dialog
      .open(CatalogEditorDialog, {
        data: row.id,
        width: '850px',
        maxWidth: '96vw',
        autoFocus: false,
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.load());
  }
}
