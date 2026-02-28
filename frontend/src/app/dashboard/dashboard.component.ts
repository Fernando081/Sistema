// frontend/src/app/dashboard/dashboard.component.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { NgxChartsModule, Color, ScaleType } from '@swimlane/ngx-charts';
import { DashboardService, DashboardMetrics } from '../services/dashboard.service';

export interface ChartDataItem {
  name: string;
  value: number;
}

export interface ChartSeries {
  name: string;
  series: ChartDataItem[];
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatIconModule, MatTableModule, NgxChartsModule],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit {
  metrics: DashboardMetrics | null = null;

  // --- DATA PARA GRÁFICAS ---
  graficaVentas: ChartSeries[] = []; // Historial
  graficaFlujo: ChartDataItem[] = []; // Balance (Nuevo)
  graficaTop: ChartDataItem[] = []; // Productos (Nuevo)

  // --- CONFIGURACIÓN VISUAL ---
  // Esquema Ventas (Verde)
  colorVentas: Color = {
    name: 'Ventas',
    selectable: true,
    group: ScaleType.Ordinal,
    domain: ['#118dff', '#A10A28', '#C7B42C', '#AAAAAA'],
  };
  // Esquema Flujo (Ámbar para cobrar, Morado para pagar)
  colorFlujo: Color = {
    name: 'Flujo',
    selectable: true,
    group: ScaleType.Ordinal,
    domain: ['#FFC107', '#9C27B0'],
  };
  // Esquema Top (Azulitos)
  colorTop: Color = {
    name: 'Top',
    selectable: true,
    group: ScaleType.Ordinal,
    domain: ['#118dff', '#4dc2ff', '#64B5F6', '#90CAF9', '#BBDEFB'],
  };

  // Tabla Stock Bajo
  displayedColumns: string[] = ['codigo', 'descripcion', 'existencia'];

  constructor(private dashboardService: DashboardService) {}

  ngOnInit(): void {
    this.dashboardService.getMetrics().subscribe((data) => {
      this.metrics = data;

      // 1. GRÁFICA DE VENTAS (HISTORIAL)
      if (data.grafica && data.grafica.length > 0) {
        const datosLimpios: ChartDataItem[] = data.grafica.map((item) => ({
          name: typeof item.name === 'string' ? item.name : 'S/F',
          value: Number(item.value || 0),
        }));
        this.graficaVentas = [{ name: 'Ventas', series: datosLimpios }];
      } else {
        this.graficaVentas = [];
      }

      // 2. GRÁFICA DE FLUJO (BALANCE) - Construcción Manual
      // Aquí comparamos Activos vs Pasivos
      this.graficaFlujo = [
        {
          name: 'Por Cobrar',
          value: Number(data.porCobrar || 0),
        },
        {
          name: 'Por Pagar',
          value: Number(data.porPagar || 0),
        },
      ];

      // 3. GRÁFICA TOP PRODUCTOS
      if (data.topProductos && data.topProductos.length > 0) {
        this.graficaTop = data.topProductos.map((item) => ({
          name: typeof item.name === 'string' ? item.name : 'Desc',
          value: Number(item.value),
        }));
      }
    });
  }
}
