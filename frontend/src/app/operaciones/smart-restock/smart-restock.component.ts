import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ProductoService } from '../../services/producto.service';
import { SmartRestockItem, PrediccionDemandaItem } from '../../producto/producto.interface';

@Component({
  selector: 'app-smart-restock',
  standalone: true,
  imports: [
    CommonModule, MatTableModule, MatTabsModule, MatButtonModule,
    MatIconModule, MatProgressSpinnerModule, MatChipsModule,
    MatTooltipModule, MatSnackBarModule,
  ],
  templateUrl: './smart-restock.component.html',
  styleUrls: ['./smart-restock.component.css'],
})
export class SmartRestockComponent implements OnInit {
  // Tab 1: Restock Básico
  displayedColumns: string[] = ['codigo', 'descripcion', 'vendidas', 'stock', 'precio', 'margen'];
  dataSource: SmartRestockItem[] = [];
  isLoading = true;

  // Tab 2: Predicción IA
  predColumns: string[] = ['codigo', 'descripcion', 'tendencia', 'vendido30', 'vendido60', 'vendido90', 'stock', 'proyectada', 'sugerida'];
  predDataSource: PrediccionDemandaItem[] = [];
  isPredLoading = true;
  isRefreshing = false;

  constructor(
    private productoService: ProductoService,
    private cdr: ChangeDetectorRef,
    private snackBar: MatSnackBar,
  ) {}

  ngOnInit() {
    this.cargarRestock();
    this.cargarPrediccion();
  }

  cargarRestock() {
    this.isLoading = true;
    this.productoService.getSmartRestock().subscribe({
      next: (res: any) => {
        this.dataSource = res.data || res;
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  cargarPrediccion() {
    this.isPredLoading = true;
    this.productoService.getPrediccionDemanda().subscribe({
      next: (res: any) => {
        this.predDataSource = res.data || res;
        this.isPredLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.isPredLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  refreshPrediccion() {
    this.isRefreshing = true;
    this.productoService.refreshPrediccion().subscribe({
      next: (res) => {
        this.snackBar.open(res.message, 'OK', { duration: 3000 });
        this.isRefreshing = false;
        this.cargarPrediccion();
      },
      error: () => {
        this.snackBar.open('Error al actualizar predicción', 'Cerrar', { duration: 3000 });
        this.isRefreshing = false;
      }
    });
  }
}
