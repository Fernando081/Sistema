// frontend/src/app/compra/compra-detalle/compra-detalle.component.ts
import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { CompraService } from '../../services/compra.service';
import { CompraResumen } from '../compra.interface';

@Component({
  selector: 'app-compra-detalle',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatTableModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Detalle de Compra</h2>
    <mat-dialog-content>
      <div class="mb-4 p-3 bg-green-50 rounded border border-green-100">
        <p class="font-bold text-sm">{{ data.nombre_proveedor }}</p>
        <p class="text-xs text-gray-500">Factura Prov: {{ data.folio_factura || 'S/N' }}</p>
        <p class="text-xs text-gray-500">Fecha: {{ data.fecha_compra | date:'medium' }}</p>
      </div>

      <table mat-table [dataSource]="detalles" class="w-full">
        <ng-container matColumnDef="cant">
          <th mat-header-cell *matHeaderCellDef> Cant. </th>
          <td mat-cell *matCellDef="let e"> {{e.cantidad}} </td>
        </ng-container>
        <ng-container matColumnDef="desc">
          <th mat-header-cell *matHeaderCellDef> Producto </th>
          <td mat-cell *matCellDef="let e"> 
            {{e.descripcion_producto}} 
            <span class="text-xs text-gray-400 block">{{e.codigo_producto}}</span>
          </td>
        </ng-container>
        <ng-container matColumnDef="costo">
          <th mat-header-cell *matHeaderCellDef> Costo </th>
          <td mat-cell *matCellDef="let e"> {{e.costo_unitario | currency}} </td>
        </ng-container>
        <ng-container matColumnDef="importe">
          <th mat-header-cell *matHeaderCellDef> Importe </th>
          <td mat-cell *matCellDef="let e"> {{e.importe | currency}} </td>
        </ng-container>

        <tr mat-header-row *matHeaderRowDef="['cant', 'desc', 'costo', 'importe']"></tr>
        <tr mat-row *matRowDef="let row; columns: ['cant', 'desc', 'costo', 'importe'];"></tr>
      </table>
      
      <div class="text-right mt-4 font-bold text-lg">
        Total: {{ data.total | currency }}
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close()">Cerrar</button>
    </mat-dialog-actions>
  `
})
export class CompraDetalleComponent implements OnInit {
  detalles: any[] = [];
  constructor(
    public dialogRef: MatDialogRef<CompraDetalleComponent>,
    @Inject(MAT_DIALOG_DATA) public data: CompraResumen,
    private compraService: CompraService
  ) {}

  ngOnInit(): void {
    this.compraService.getDetalleCompra(this.data.id_compra).subscribe(res => this.detalles = res);
  }
}