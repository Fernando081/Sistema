import { Component, Inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  MatDialogRef,
  MAT_DIALOG_DATA,
  MatDialogModule,
} from '@angular/material/dialog';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';

import { VentaService } from '../services/venta.service';
import { FacturaResumen } from './venta.interface';

@Component({
  selector: 'app-buscador-facturas-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatProgressSpinnerModule
  ],
  template: `
    <h2 mat-dialog-title>Buscar Factura para Relacionar</h2>
    <mat-dialog-content>
      <div class="flex flex-col gap-4 mt-2">
        <mat-form-field appearance="outline" class="w-full">
          <mat-label>Filtrar resultados (Folio, UUID, etc.)</mat-label>
          <input matInput (keyup)="applyFilter($event)" placeholder="Ej. F-1234">
          <mat-icon matSuffix>search</mat-icon>
        </mat-form-field>

        <div *ngIf="isLoading()" class="flex justify-center p-4">
          <mat-spinner diameter="40"></mat-spinner>
        </div>

        <div class="overflow-auto max-h-[400px]" *ngIf="!isLoading()">
          <table mat-table [dataSource]="dataSource" class="w-full">
            
            <ng-container matColumnDef="serieFolio">
              <th mat-header-cell *matHeaderCellDef> Serie/Folio </th>
              <td mat-cell *matCellDef="let element" class="font-medium"> {{element.serie}}-{{element.folio}} </td>
            </ng-container>

            <ng-container matColumnDef="fecha">
              <th mat-header-cell *matHeaderCellDef> Fecha </th>
              <td mat-cell *matCellDef="let element"> {{element.fecha_emision | date:'mediumDate'}} </td>
            </ng-container>

            <ng-container matColumnDef="total">
              <th mat-header-cell *matHeaderCellDef> Total </th>
              <td mat-cell *matCellDef="let element"> {{element.total | currency}} </td>
            </ng-container>

            <ng-container matColumnDef="uuid">
              <th mat-header-cell *matHeaderCellDef> UUID </th>
              <td mat-cell *matCellDef="let element" class="text-xs text-gray-500"> {{element.uuid}} </td>
            </ng-container>

            <ng-container matColumnDef="acciones">
              <th mat-header-cell *matHeaderCellDef> </th>
              <td mat-cell *matCellDef="let element">
                <button mat-button color="primary" (click)="seleccionar(element.uuid)">Seleccionar</button>
              </td>
            </ng-container>

            <tr mat-header-row *matHeaderRowDef="displayedColumns; sticky: true"></tr>
            <tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>
            <tr class="mat-row" *matNoDataRow>
              <td class="mat-cell text-center p-4" colspan="5">No se encontraron facturas timbradas para este cliente.</td>
            </tr>
          </table>
        </div>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancelar</button>
    </mat-dialog-actions>
  `
})
export class BuscadorFacturasDialogComponent implements OnInit {
  displayedColumns: string[] = ['serieFolio', 'fecha', 'total', 'uuid', 'acciones'];
  dataSource: FacturaResumen[] = [];
  allData: FacturaResumen[] = [];
  isLoading = signal(true);

  constructor(
    public dialogRef: MatDialogRef<BuscadorFacturasDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { idCliente: number },
    private ventaService: VentaService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit() {
    this.cargarFacturas();
  }

  cargarFacturas() {
    this.isLoading.set(true);
    this.ventaService.getFacturasRelacionables(this.data.idCliente).subscribe({
      next: (data) => {
        this.allData = data;
        this.dataSource = data;
        this.isLoading.set(false);
      },
      error: (err) => {
        this.snackBar.open('Error al cargar facturas', 'Cerrar', { duration: 3000 });
        this.isLoading.set(false);
      }
    });
  }

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value.toLowerCase();
    this.dataSource = this.allData.filter(f => 
      f.uuid?.toLowerCase().includes(filterValue) ||
      `${f.serie}-${f.folio}`.toLowerCase().includes(filterValue) ||
      f.total.toString().includes(filterValue)
    );
  }

  seleccionar(uuid: string) {
    this.dialogRef.close(uuid);
  }
}
