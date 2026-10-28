import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Producto, ProductoAlternativa } from '../producto/producto.interface';

export interface AlternativasDialogData {
  productoOriginal: Producto;
  alternativas: ProductoAlternativa[];
}

@Component({
  selector: 'app-alternativas-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title class="flex items-center gap-2">
      <mat-icon class="text-[var(--c-warning)]">swap_horiz</mat-icon> Alternativas disponibles
    </h2>
    <mat-dialog-content class="!pb-6">
      <p class="mb-4 text-sm">
        El producto <strong>"{{ data.productoOriginal.descripcion }}"</strong> está agotado. Estas opciones tienen un cruce registrado; verifica la aplicación, el motor y las restricciones antes de sustituir la pieza.
      </p>

      <div class="overflow-x-auto w-full border rounded-lg shadow-sm">
        <table class="w-full text-sm text-left whitespace-nowrap">
          <thead class="bg-[var(--c-surface-2)] text-[var(--c-text-2)] uppercase text-xs border-b">
            <tr>
              <th scope="col" class="px-4 py-3">Código</th>
              <th scope="col" class="px-4 py-3">Descripción</th>
              <th scope="col" class="px-4 py-3">Marca</th>
              <th scope="col" class="px-4 py-3 text-right">Precio</th>
              <th scope="col" class="px-4 py-3 text-center">Existencia</th>
              <th scope="col" class="px-4 py-3 text-right">Sustitución rápida</th>
            </tr>
          </thead>
          <tbody>
            @for (alt of data.alternativas; track alt.id_producto) {
              <tr class="border-b hover:bg-[var(--c-surface-sunken)] transition-colors">
                <td class="px-4 py-3"><span class="code-chip">{{ alt.codigo }}</span></td>
                <td class="px-4 py-3 font-medium">{{ alt.descripcion }}</td>
                <td class="px-4 py-3">
                   <span class="bg-[var(--c-surface-sunken)] px-2 py-0.5 rounded text-xs">{{ alt.marca }}</span>
                </td>
                <td class="px-4 py-3 font-semibold text-right tabular-nums text-[var(--c-text)]">{{ alt.precio | currency }}</td>
                <td class="px-4 py-3 font-bold text-center">
                   @if (alt.stock > 0) {
                     <span class="badge badge-success">{{ alt.stock }}</span>
                   } @else {
                     <span class="badge badge-danger">{{ alt.stock }}</span>
                   }
                </td>
                <td class="px-4 py-3 text-right">
                  <button mat-flat-button (click)="sustituir(alt)" [disabled]="alt.stock <= 0" [attr.aria-label]="'Sustituir por ' + alt.descripcion">
                    <mat-icon class="!mr-1">add_shopping_cart</mat-icon> Sustituir
                  </button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="!px-6 !py-4 border-t">
      <button mat-stroked-button mat-dialog-close>Cerrar</button>
    </mat-dialog-actions>
  `
})
export class AlternativasDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<AlternativasDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: AlternativasDialogData
  ) {}

  sustituir(alternativa: ProductoAlternativa) {
    this.dialogRef.close(alternativa);
  }
}
