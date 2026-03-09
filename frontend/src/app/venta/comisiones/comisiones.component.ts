import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { VentaService } from '../../services/venta.service';
import { MatIconModule } from '@angular/material/icon';

export interface ComisionSemanas {
  semana: string;
  id_vendedor: number;
  vendedor_nombre: string;
  ventas_realizadas: number;
  total_ventas_brutas: string;
  comisiones_acumuladas: string;
}

@Component({
  selector: 'app-comisiones',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatTableModule,
    MatProgressSpinnerModule,
    MatIconModule
  ],
  template: `
    <div class="comisiones-container">
      <mat-card class="table-card">
        <mat-card-header>
          <mat-card-title>
            <mat-icon color="primary">account_balance_wallet</mat-icon>
            Comisiones de Vendedores
          </mat-card-title>
          <mat-card-subtitle>
            Acumulado semanal del 2% por ventas realizadas
          </mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          
          <div *ngIf="isLoading()" class="loading-state">
            <mat-spinner diameter="40"></mat-spinner>
          </div>

          <table mat-table [dataSource]="comisiones()" class="comisiones-table" *ngIf="!isLoading()">
            
            <ng-container matColumnDef="semana">
              <th mat-header-cell *matHeaderCellDef> Semana (Año-Num) </th>
              <td mat-cell *matCellDef="let element"> {{element.semana}} </td>
            </ng-container>

            <ng-container matColumnDef="vendedor">
              <th mat-header-cell *matHeaderCellDef> Vendedor </th>
              <td mat-cell *matCellDef="let element">
                <b>{{element.vendedor_nombre | uppercase}}</b>
              </td>
            </ng-container>

            <ng-container matColumnDef="ventas">
              <th mat-header-cell *matHeaderCellDef> Ventas Realizadas </th>
              <td mat-cell *matCellDef="let element"> {{element.ventas_realizadas}} </td>
            </ng-container>

            <ng-container matColumnDef="subtotal">
              <th mat-header-cell *matHeaderCellDef> Subtotal Ventas </th>
              <td mat-cell *matCellDef="let element"> $ {{element.total_ventas_brutas | number:'1.2-2'}} </td>
            </ng-container>

            <ng-container matColumnDef="comision">
              <th mat-header-cell *matHeaderCellDef> Comisión (2%) </th>
              <td mat-cell *matCellDef="let element" class="comision-cell">
                 $ {{element.comisiones_acumuladas | number:'1.2-2'}}
              </td>
            </ng-container>

            <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>
          </table>

          <div *ngIf="!isLoading() && comisiones().length === 0" class="empty-state">
            No hay comisiones registradas aún.
          </div>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    .comisiones-container {
      padding: 24px;
      max-width: 1200px;
      margin: 0 auto;
    }
    
    .table-card {
      border-radius: 12px;
      box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
    }
    
    mat-card-header {
      margin-bottom: 24px;
      padding: 16px 24px 0;
    }
    
    mat-card-title {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 1.5rem;
      color: #1a202c;
    }
    
    .comisiones-table {
      width: 100%;
    }
    
    .loading-state, .empty-state {
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 48px;
      color: #718096;
    }
    
    .comision-cell {
      color: #38a169;
      font-weight: bold;
    }
    
    th.mat-header-cell {
      color: #4a5568;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 0.75rem;
      letter-spacing: 0.05em;
    }
  `]
})
export class ComisionesComponent implements OnInit {
  comisiones = signal<ComisionSemanas[]>([]);
  isLoading = signal<boolean>(true);
  displayedColumns: string[] = ['semana', 'vendedor', 'ventas', 'subtotal', 'comision'];

  constructor(private ventaService: VentaService) {}

  ngOnInit() {
    this.cargarComisiones();
  }

  cargarComisiones() {
    this.isLoading.set(true);
    this.ventaService.getComisiones().subscribe({
      next: (data) => {
        this.comisiones.set(data);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Error cargando comisiones', err);
        this.isLoading.set(false);
      }
    });
  }
}
