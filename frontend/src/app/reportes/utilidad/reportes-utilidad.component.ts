import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { NgxChartsModule } from '@swimlane/ngx-charts';
import { ReportesService, ProductoUtilidad } from '../../services/reportes.service';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-reportes-utilidad',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatIconModule, MatTableModule, NgxChartsModule],
  templateUrl: './reportes-utilidad.component.html',
})
export class ReportesUtilidadComponent {
  private reportesService = inject(ReportesService);

  // Reactive state using Signals
  productos = toSignal(this.reportesService.getReporteUtilidad(), {
    initialValue: [] as ProductoUtilidad[],
  });

  // Computed chart data
  graficaTop = computed(() => {
    const data = this.productos();
    const top5 = [...data].sort((a, b) => b.utilidadNeta - a.utilidadNeta).slice(0, 5);
    return top5.map((item) => ({
      name: item.descripcion,
      value: item.utilidadNeta,
    }));
  });

  // Table Configuration
  displayedColumns: string[] = [
    'producto',
    'unidades_vendidas',
    'ingresos',
    'costos',
    'utilidad_neta',
    'margen_porcentaje',
  ];

  // Chart Colors (MaterialPro style)
  colorTop: any = { domain: ['#1976D2', '#2196F3', '#64B5F6', '#90CAF9', '#BBDEFB'] };
}
