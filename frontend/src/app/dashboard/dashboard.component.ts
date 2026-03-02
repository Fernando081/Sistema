// frontend/src/app/dashboard/dashboard.component.ts
import { Component, inject } from '@angular/core';
import { CommonModule, CurrencyPipe, PercentPipe, DecimalPipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { NgxEchartsModule } from 'ngx-echarts';
import { EChartsOption } from 'echarts';
import { toSignal } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  DashboardService,
  CategoriaVenta,
  HoraDiaVenta,
  RentabilidadProveedor,
  HistoricoDato,
} from '../services/dashboard.service';
import { ThemeService } from '../services/theme.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatIconModule, MatTableModule, NgxEchartsModule],
  providers: [CurrencyPipe, PercentPipe, DecimalPipe],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent {
  private dashboardService = inject(DashboardService);
  private themeService = inject(ThemeService);

  theme = this.themeService.isDarkMode;

  dashboardData = toSignal(
    forkJoin({
      metrics: this.dashboardService.getMetrics(),
      ventas: this.dashboardService.getVentas().pipe(map((res) => res[0])),
      inventario: this.dashboardService.getInventario().pipe(map((res) => res[0])),
      clientes: this.dashboardService.getClientes().pipe(map((res) => res[0])),
      operaciones: this.dashboardService.getOperaciones().pipe(map((res) => res[0])),
    }).pipe(
      map((data) => {
        return {
          ...data,
          chartVentasPorCategoria: this.buildVentasPorCategoriaChart(
            data.ventas?.ventas_por_categoria || [],
          ),
          chartComportamientoHoraDia: this.buildComportamientoHoraDiaChart(
            data.ventas?.comportamiento_hora_dia || [],
          ),
          chartRentabilidad: this.buildRentabilidadChart(
            data.operaciones?.rentabilidad_proveedor_marca || [],
          ),
          chartLineas: this.buildLineasChart(
            data.operaciones?.tasa_de_devoluciones_historico || [],
          ),
          chartTendenciaVentas: this.buildTendenciaVentasChart(data.metrics?.grafica || []),
          chartFlujoDinero: this.buildFlujoDineroChart(
            data.metrics?.porCobrar || 0,
            data.metrics?.porPagar || 0,
          ),
          chartTopOriginal: this.buildTopOriginalChart(data.metrics?.topProductos || []),
        };
      }),
    ),
  );

  displayedColumns = ['codigo', 'descripcion', 'dias_sin_ventas', 'existencia'];
  agingColumns = ['rango', 'monto'];
  alertaColumns = ['codigo', 'descripcion', 'existencia'];

  private buildTendenciaVentasChart(grafica: { name: string; value: number }[]): EChartsOption {
    const dates = grafica.map((g) => g.name || 'S/F');
    const values = grafica.map((g) => Number(g.value) || 0);

    return {
      tooltip: { trigger: 'axis' },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: dates },
      yAxis: { type: 'value' },
      series: [
        {
          name: 'Ventas ($)',
          type: 'line',
          data: values,
          areaStyle: {
            opacity: 0.5,
            color: '#118dff',
          },
          itemStyle: { color: '#118dff' },
          smooth: true,
        },
      ],
    };
  }

  private buildFlujoDineroChart(porCobrar: number, porPagar: number): EChartsOption {
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: { type: 'category', data: ['Por Cobrar', 'Por Pagar'] },
      yAxis: { type: 'value' },
      series: [
        {
          name: 'Flujo',
          type: 'bar',
          data: [
            { value: porCobrar, itemStyle: { color: '#FFC107' } },
            { value: porPagar, itemStyle: { color: '#9C27B0' } },
          ],
          label: { show: true, position: 'top' },
        },
      ],
    };
  }

  private buildTopOriginalChart(topProductos: { name: string; value: number }[]): EChartsOption {
    const data = [...topProductos];
    // Reverse because ECharts draws from bottom to top for bar series with yAxis category
    data.reverse();

    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: { type: 'value' },
      yAxis: { type: 'category', data: data.map((d) => d.name || 'Desc') },
      series: [
        {
          name: 'Cantidad Vendida',
          type: 'bar',
          data: data.map((d) => Number(d.value)),
          itemStyle: { color: '#64B5F6' },
        },
      ],
    };
  }

  private buildVentasPorCategoriaChart(ventasPorCategoria: CategoriaVenta[]): EChartsOption {
    const data = [...ventasPorCategoria].sort((a, b) => Number(b.ventas) - Number(a.ventas));
    // Top 10 AND Bottom 10 as per requirement
    const top10 = data.slice(0, 5);
    const bottom10 = data.slice(-5).reverse();
    const combined = [...top10, ...bottom10];

    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: { type: 'value' },
      yAxis: { type: 'category', data: combined.map((d) => d.categoria).reverse() },
      series: [
        {
          name: 'Ventas',
          type: 'bar',
          data: combined.map((d) => d.ventas).reverse(),
          itemStyle: {
            color: (params) => {
              // Color top 5 differently from bottom 5
              return params.dataIndex >= 5 ? '#ff4d4f' : '#118dff';
            },
          },
        },
      ],
    };
  }

  private buildComportamientoHoraDiaChart(comportamiento: HoraDiaVenta[]): EChartsOption {
    const hours = Array.from({ length: 24 }, (_, i) => `${i}:00`);
    const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

    const data = comportamiento.map((item) => {
      const dow = Number(item.dia);
      const dayIndex = dow === 0 ? 6 : dow - 1; // Map Postgres DOW (0=Sun, 1=Mon) to our array (0=Mon, 6=Sun)

      return [Number(item.hora), dayIndex, Number(item.ventas) || 0];
    });

    return {
      tooltip: { position: 'top' },
      grid: { height: '70%', top: '10%' },
      xAxis: { type: 'category', data: hours, splitArea: { show: true } },
      yAxis: { type: 'category', data: days, splitArea: { show: true } },
      visualMap: {
        min: 0,
        max: Math.max(...data.map((d) => d[2] as number), 100),
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: '1%',
      },
      series: [
        {
          name: 'Ventas ($)',
          type: 'heatmap',
          data: data,
          label: { show: false },
          emphasis: {
            itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0, 0, 0, 0.5)' },
          },
        },
      ],
    };
  }

  private buildRentabilidadChart(rentabilidad: RentabilidadProveedor[]): EChartsOption {
    const data = rentabilidad.map((r) => ({
      name: r.marca || r.proveedor || 'Desconocido',
      value: Number(r.rentabilidad),
    }));

    return {
      tooltip: { trigger: 'item' },
      legend: { top: '5%', left: 'center', type: 'scroll' },
      series: [
        {
          name: 'Rentabilidad',
          type: 'pie',
          radius: ['40%', '70%'],
          avoidLabelOverlap: false,
          itemStyle: { borderRadius: 10, borderColor: '#fff', borderWidth: 2 },
          label: { show: false, position: 'center' },
          emphasis: {
            label: { show: true, fontSize: 16, fontWeight: 'bold' },
          },
          labelLine: { show: false },
          data: data,
        },
      ],
    };
  }

  private buildLineasChart(devolucionesHistorico: HistoricoDato[]): EChartsOption {
    const devoluciones = devolucionesHistorico || [];

    let meses = [...new Set(devoluciones.map((d) => d.mes))].sort();

    if (meses.length === 0) {
      const today = new Date();
      meses = [`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`];
    }

    return {
      tooltip: { trigger: 'axis' },
      legend: { data: ['Tasa Devoluciones (%)'] },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: meses },
      yAxis: { type: 'value', name: 'Devoluciones (%)' },
      series: [
        {
          name: 'Tasa Devoluciones (%)',
          type: 'line',
          data: meses.map((m) => Number(devoluciones.find((d) => d.mes === m)?.valor || 0)),
          smooth: true,
          itemStyle: { color: '#FFC107' },
        },
      ],
    };
  }
}
