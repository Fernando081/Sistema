// frontend/src/app/dashboard/dashboard.component.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { NgxChartsModule } from '@swimlane/ngx-charts';
import { DashboardService, DashboardMetrics } from '../services/dashboard.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule, MatCardModule, MatIconModule, MatTableModule, 
    NgxChartsModule 
  ],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit {
  metrics: DashboardMetrics | null = null;
  
  // Variable ESPECIAL para la gráfica (Formato Multi-Serie)
  graficaData: any[] = []; 

  // Configuración Gráfica
  view: [number, number] = [800, 300]; 
  colorScheme: any = { domain: ['#5AA454', '#E44D25', '#CFC0BB', '#7aa3e5', '#a8385d', '#aae3f5'] };
  
  // Tabla Stock Bajo
  displayedColumns: string[] = ['codigo', 'descripcion', 'existencia'];

  constructor(private dashboardService: DashboardService) {}

  ngOnInit(): void {
    this.dashboardService.getMetrics().subscribe(data => {
      // 1. Imprimir en consola para que veas qué llega realmente (F12)
      console.log('--- DATOS DEL BACKEND ---', data);
      
      this.metrics = data;

      // 2. ADAPTADOR ROBUSTO PARA LA GRÁFICA
      if (data.grafica && Array.isArray(data.grafica) && data.grafica.length > 0) {
        
        const datosLimpios = data.grafica.map((item: any) => ({
          // Intentamos leer 'name' o 'Name' (por si acaso)
          name: item.name || item.Name || 'Sin Fecha',
          
          // Intentamos leer 'value' o 'Value', y forzamos a Número
          value: Number(item.value || item.Value || 0)
        }));

        console.log('Datos procesados para gráfica:', datosLimpios);

        this.graficaData = [
          {
            name: 'Ventas',
            series: datosLimpios
          }
        ];
      } else {
        // Si el arreglo está vacío, ponemos datos en 0 para que no se rompa
        console.warn('El backend no devolvió datos para la gráfica (Array vacío).');
        this.graficaData = []; 
      }
    });
  }
}