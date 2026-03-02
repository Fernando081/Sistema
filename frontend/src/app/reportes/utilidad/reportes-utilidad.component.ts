import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { NgxEchartsModule } from 'ngx-echarts';
import { EChartsOption } from 'echarts';
import { ReportesService, ProductoUtilidad } from '../../services/reportes.service';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-reportes-utilidad',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatIconModule, MatTableModule, NgxEchartsModule],
  templateUrl: './reportes-utilidad.component.html',
})
export class ReportesUtilidadComponent {
  private reportesService = inject(ReportesService);

  // Reactive state using Signals
  productos = toSignal(this.reportesService.getReporteUtilidad(), {
    initialValue: [] as ProductoUtilidad[],
  });

  // Computed chart data
  graficaTop = computed<EChartsOption>(() => {
    const data = this.productos();
    const top5 = [...data].sort((a, b) => b.utilidadNeta - a.utilidadNeta).slice(0, 5);

    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'category', data: top5.map((item) => item.descripcion) },
      yAxis: { type: 'value' },
      series: [
        {
          name: 'Utilidad Neta',
          type: 'bar',
          data: top5.map((item) => item.utilidadNeta),
          itemStyle: { color: '#1976D2' },
        },
      ],
    };
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
}
