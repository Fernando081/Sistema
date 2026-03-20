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
    <h2 mat-dialog-title class="font-bold flex items-center gap-2">
      <mat-icon class="text-yellow-600">swap_horiz</mat-icon> Alternativas Disponibles
    </h2>
    <mat-dialog-content class="!pb-6">
      <p class="mb-4 text-sm dark:text-gray-300">
        El producto <strong>"{{ data.productoOriginal.descripcion }}"</strong> está agotado. Con base en nuestros cruces de sistema, te sugerimos las siguientes opciones en existencia con compatibilidad garantizada:
      </p>

      <div class="overflow-x-auto w-full border dark:border-slate-700 rounded-lg shadow-sm">
        <table class="w-full text-sm text-left whitespace-nowrap">
          <thead class="bg-gray-50 dark:bg-slate-800 text-gray-700 dark:text-gray-300 uppercase text-xs border-b dark:border-slate-700">
            <tr>
              <th scope="col" class="px-4 py-3">Código</th>
              <th scope="col" class="px-4 py-3">Descripción</th>
              <th scope="col" class="px-4 py-3">Marca</th>
              <th scope="col" class="px-4 py-3">Precio</th>
              <th scope="col" class="px-4 py-3 text-center">Stock</th>
              <th scope="col" class="px-4 py-3 text-right">Sustitución rápida</th>
            </tr>
          </thead>
          <tbody>
            @for (alt of data.alternativas; track alt.id_producto) {
              <tr class="border-b dark:border-slate-700 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                <td class="px-4 py-3 font-mono text-xs">{{ alt.codigo }}</td>
                <td class="px-4 py-3 font-medium">{{ alt.descripcion }}</td>
                <td class="px-4 py-3">
                   <span class="bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded text-xs">{{ alt.marca }}</span>
                </td>
                <td class="px-4 py-3 font-bold text-blue-600 dark:text-blue-400">{{ alt.precio | currency }}</td>
                <td class="px-4 py-3 font-bold text-center">
                   @if (alt.stock > 0) {
                     <span class="text-green-600 bg-green-50 dark:bg-green-900/40 px-2 py-1 rounded">{{ alt.stock }}</span>
                   } @else {
                     <span class="text-red-600 bg-red-50 dark:bg-red-900/40 px-2 py-1 rounded">{{ alt.stock }}</span>
                   }
                </td>
                <td class="px-4 py-3 text-right">
                  <button mat-flat-button color="accent" (click)="sustituir(alt)" [disabled]="alt.stock <= 0" class="!rounded-full shadow-md">
                    <mat-icon class="!mr-1">add_shopping_cart</mat-icon> Sustituir
                  </button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="!px-6 !py-4 border-t dark:border-slate-700">
      <button mat-stroked-button mat-dialog-close>Cerrar Ventana</button>
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
