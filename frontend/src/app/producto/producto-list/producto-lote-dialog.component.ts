import { CurrencyPipe } from '@angular/common';
import { Component, Inject, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { finalize } from 'rxjs';
import { Categoria } from '../../categoria/categoria.interface';
import { CategoriaService } from '../../services/categoria.service';
import { ProductoLoteRequest, ProductoLoteVista, ProductoService } from '../../services/producto.service';

export interface ProductoLoteDialogData { accion: 'precio' | 'categoria'; ids: number[]; }

/** U02.3 · Cambio de precio (porcentaje) o categoría para varios productos: primero vista previa, luego aplicar. */
@Component({
  selector: 'app-producto-lote-dialog',
  standalone: true,
  imports: [FormsModule, CurrencyPipe, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>{{ data.accion === 'precio' ? 'Cambiar precio' : 'Cambiar categoría' }} de {{ data.ids.length }} productos</h2>
    <mat-dialog-content>
      <div class="lote-form">
        @if (data.accion === 'precio') {
          <mat-form-field>
            <mat-label>Porcentaje</mat-label>
            <input matInput type="number" step="0.5" min="-90" max="500" [(ngModel)]="porcentaje" (ngModelChange)="vista.set(null)">
            <span matTextSuffix>%</span>
            <mat-hint>10 sube 10 %; -5 baja 5 %</mat-hint>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Redondeo</mat-label>
            <mat-select [(ngModel)]="redondeo" (ngModelChange)="vista.set(null)">
              <mat-option value="centavos">A centavos</mat-option>
              <mat-option value="pesos">A pesos enteros</mat-option>
            </mat-select>
          </mat-form-field>
        } @else {
          <mat-form-field class="grow">
            <mat-label>Nueva categoría</mat-label>
            <mat-select [(ngModel)]="idCategoria" (ngModelChange)="vista.set(null)">
              @for (c of categorias(); track c.idCategoria) { <mat-option [value]="c.idCategoria">{{ c.descripcion }}</mat-option> }
            </mat-select>
          </mat-form-field>
        }
        <button mat-stroked-button type="button" [disabled]="!valido() || cargando()" (click)="previsualizar()"><mat-icon>preview</mat-icon>Ver vista previa</button>
      </div>
      @if (vista(); as v) {
        <p class="lote-resumen" role="status">
          {{ v.resumen.conCambio }} de {{ v.resumen.productos }} productos cambian.
          @if (data.accion === 'precio') { Suma de precios: {{ v.resumen.totalActual | currency:'MXN' }} → {{ v.resumen.totalNuevo | currency:'MXN' }}. }
        </p>
        <div class="lote-tabla" tabindex="0" role="region" aria-label="Vista previa de cambios">
          <table>
            <thead><tr><th>Código</th><th>Producto</th><th>Actual</th><th>Nuevo</th></tr></thead>
            <tbody>
              @for (c of v.cambios; track c.idProducto) {
                <tr [class.sin-cambio]="!c.cambia">
                  <td>{{ c.codigo }}</td><td>{{ c.descripcion }}</td>
                  @if (data.accion === 'precio') {
                    <td class="num">{{ c.precioActual | currency:'MXN' }}</td><td class="num"><strong>{{ c.precioNuevo | currency:'MXN' }}</strong></td>
                  } @else {
                    <td>{{ c.categoriaActual || 'Sin categoría' }}</td><td><strong>{{ c.categoriaNueva }}</strong></td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancelar</button>
      <button mat-flat-button type="button" [disabled]="!vista()?.resumen?.conCambio || cargando()" (click)="aplicar()">Aplicar a {{ vista()?.resumen?.conCambio || 0 }} productos</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .lote-form{display:flex;flex-wrap:wrap;align-items:flex-start;gap:.75rem;padding-top:.25rem}
    .lote-form .grow{flex:1;min-width:220px}
    .lote-form button{height:52px}
    .lote-resumen{margin:.75rem 0 .5rem;color:var(--c-text-2);font-size:.88rem}
    .lote-tabla{max-height:320px;overflow:auto;border:1px solid var(--c-border);border-radius:var(--radius-md)}
    .lote-tabla table{width:100%;border-collapse:collapse;font-size:.84rem}
    .lote-tabla th,.lote-tabla td{padding:.45rem .6rem;border-bottom:1px solid var(--c-border);text-align:left}
    .lote-tabla th{position:sticky;top:0;background:var(--c-surface-2);color:var(--c-text-2);font-weight:600}
    .lote-tabla .num{text-align:right;font-variant-numeric:tabular-nums}
    .lote-tabla tr.sin-cambio td{color:var(--c-text-3)}
  `],
})
export class ProductoLoteDialogComponent {
  private readonly productos = inject(ProductoService);
  readonly categorias = signal<Categoria[]>([]);
  readonly vista = signal<ProductoLoteVista | null>(null);
  readonly cargando = signal(false);
  porcentaje: number | null = null;
  redondeo: 'centavos' | 'pesos' = 'centavos';
  idCategoria: number | null = null;
  /** Un solo requestId por diálogo: reintentar "Aplicar" no repite los cambios. */
  private readonly requestId = crypto.randomUUID();

  constructor(
    readonly ref: MatDialogRef<ProductoLoteDialogComponent, { message: string } | undefined>,
    @Inject(MAT_DIALOG_DATA) readonly data: ProductoLoteDialogData,
  ) {
    if (data.accion === 'categoria') inject(CategoriaService).getCategorias().subscribe((c) => this.categorias.set(c));
  }

  valido(): boolean {
    if (this.data.accion === 'categoria') return !!this.idCategoria;
    return this.porcentaje !== null && Number.isFinite(Number(this.porcentaje)) && Number(this.porcentaje) !== 0
      && Number(this.porcentaje) >= -90 && Number(this.porcentaje) <= 500;
  }

  private request(): ProductoLoteRequest {
    return this.data.accion === 'precio'
      ? { ids: this.data.ids, accion: 'precio', porcentaje: Number(this.porcentaje), redondeo: this.redondeo }
      : { ids: this.data.ids, accion: 'categoria', idCategoria: Number(this.idCategoria) };
  }

  previsualizar(): void {
    this.cargando.set(true);
    this.productos.vistaPreviaLote(this.request()).pipe(finalize(() => this.cargando.set(false)))
      .subscribe((vista) => this.vista.set(vista));
  }

  aplicar(): void {
    const vista = this.vista();
    if (!vista) return;
    this.cargando.set(true);
    const esperados = vista.cambios.map((c) => ({ idProducto: c.idProducto, precio: c.precioActual, idCategoria: c.idCategoriaActual }));
    this.productos.aplicarLote({ ...this.request(), requestId: this.requestId, esperados })
      .pipe(finalize(() => this.cargando.set(false)))
      .subscribe({
        next: (res) => this.ref.close(res),
        // Si algo cambió desde la vista previa se descarta para obligar a revisarla otra vez.
        error: () => this.vista.set(null),
      });
  }
}
