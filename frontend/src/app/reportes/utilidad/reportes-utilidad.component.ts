import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { NgxChartsModule } from '@swimlane/ngx-charts';
import { ReportesService, ProductoUtilidad } from '../../services/reportes.service';

@Component({
  selector: 'app-reportes-utilidad',
  standalone: true,
  imports: [
    CommonModule, 
    MatCardModule, 
    MatIconModule, 
    MatTableModule, 
    NgxChartsModule
  ],
  templateUrl: './reportes-utilidad.component.html',
})
export class ReportesUtilidadComponent implements OnInit {
  productos: ProductoUtilidad[] = [];
  
  // Chart Data
  graficaTop: any[] = [];
  
  // Table Configuration
  displayedColumns: string[] = ['producto', 'unidades_vendidas', 'ingresos', 'costos', 'utilidad_neta', 'margen_porcentaje'];

  // Chart Colors (MaterialPro style)
  colorTop: any = { domain: ['#1976D2', '#2196F3', '#64B5F6', '#90CAF9', '#BBDEFB'] };

  constructor(private reportesService: ReportesService) {}

  ngOnInit(): void {
    this.reportesService.getReporteUtilidad().subscribe({
      next: (data) => {
        this.productos = data;
        
        // Transform data for top 5 chart
        // Assuming data is already sorted by the backend, or we sort it here
        const top5 = [...data].sort((a, b) => b.utilidadNeta - a.utilidadNeta).slice(0, 5);
        
        this.graficaTop = top5.map(item => ({
          name: item.descripcion,
          value: item.utilidadNeta
        }));
      },
      error: (err) => {
        console.error('Error fetching profit report:', err);
      }
    });
  }
}
