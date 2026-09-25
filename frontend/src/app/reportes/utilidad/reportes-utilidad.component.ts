import { Component, computed, inject, signal } from '@angular/core';
import { catchError, of } from 'rxjs';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import type { EChartsCoreOption as EChartsOption } from 'echarts/core';
import { ReportesService, ProductoUtilidad } from '../../services/reportes.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { ErpEchartsDirective } from '../../shared/echarts.provider';

@Component({
  selector: 'app-reportes-utilidad',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatIconModule, MatTableModule, ErpEchartsDirective],
  templateUrl: './reportes-utilidad.component.html',
})
export class ReportesUtilidadComponent {
  private reportesService = inject(ReportesService);
  readonly loadError = signal(false);

  // Reactive state using Signals
  productos = toSignal(this.reportesService.getReporteUtilidad().pipe(catchError(() => { this.loadError.set(true); return of([]); })), {
    initialValue: [] as ProductoUtilidad[],
  });

  // Computed chart data
  graficaTop = computed<EChartsOption>(() => {
    const data = this.productos();
    const top5 = [...data]
      .filter((item) => item.costoConocido && item.utilidadBruta !== null)
      .sort((a, b) => (b.utilidadBruta || 0) - (a.utilidadBruta || 0))
      .slice(0, 5);

    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'category', data: top5.map((item) => item.descripcion) },
      yAxis: { type: 'value' },
      series: [
        {
          name: 'Margen bruto',
          type: 'bar',
          data: top5.map((item) => item.utilidadBruta),
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
