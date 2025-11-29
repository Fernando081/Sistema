// frontend/src/app/dashboard/dashboard.component.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { NgxChartsModule } from '@swimlane/ngx-charts'; // <--- Importante
import { DashboardService, DashboardMetrics } from '../services/dashboard.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule, MatCardModule, MatIconModule, MatTableModule, 
    NgxChartsModule // <--- Agregar módulo de gráficas
  ],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit {
  metrics: DashboardMetrics | null = null;
  
  // Configuración Gráfica
  view: [number, number] = [700, 300]; // Tamaño inicial
  colorScheme: any = { domain: ['#5AA454', '#E44D25', '#CFC0BB', '#7aa3e5', '#a8385d', '#aae3f5'] };
  
  // Tabla Stock Bajo
  displayedColumns: string[] = ['codigo', 'descripcion', 'existencia'];

  constructor(private dashboardService: DashboardService) {}

  ngOnInit(): void {
    this.dashboardService.getMetrics().subscribe(data => {
      this.metrics = data;
    });
  }
}