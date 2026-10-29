// frontend/src/app/dashboard/dashboard.component.ts
import { Component, ElementRef, inject, effect, signal, viewChild, WritableSignal } from '@angular/core';
import anime from 'animejs';
import { CommonModule, CurrencyPipe, PercentPipe, DecimalPipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import type { EChartsCoreOption as EChartsOption } from 'echarts/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { forkJoin, of, timer } from 'rxjs';
import { catchError, filter, map, switchMap } from 'rxjs/operators';
import {
  DashboardService,
  CategoriaVenta,
  HoraDiaVenta,
  RentabilidadProveedor,
  HistoricoDato,
  ScheduledJobName, OutputsHealthLevel,
} from '../services/dashboard.service';
import { ErpEchartsDirective } from '../shared/echarts.provider';
import { CrmService } from '../services/crm.service';
import { ActivatedRoute, NavigationEnd, NavigationSkipped, Router, RouterLink } from '@angular/router';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatCardModule, MatIconModule, MatTableModule, ErpEchartsDirective, RouterLink],
  providers: [CurrencyPipe, PercentPipe, DecimalPipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.css',
})
export class DashboardComponent {
  private dashboardService = inject(DashboardService);
  private crmService = inject(CrmService);
  private readonly route = inject(ActivatedRoute);
  private readonly automaticProcesses = viewChild<ElementRef<HTMLDetailsElement>>('automaticProcesses');
  private readonly outputsPanel = viewChild<ElementRef<HTMLDetailsElement>>('outputsPanel');
  private readonly navigation = toSignal(inject(Router).events.pipe(
    filter(event => event instanceof NavigationEnd || event instanceof NavigationSkipped),
  ));

  // Animated Signals
  ventasHoyAnimado = signal(0);
  porCobrarAnimado = signal(0);
  porPagarAnimado = signal(0);
  conteoBajosAnimado = signal(0);
  ingresosNetosAnimado = signal(0);
  ticketPromedioAnimado = signal(0);
  valorInventarioAnimado = signal(0);
  tasaCumplimientoAnimado = signal(0);
  valorTiempoVidaAnimado = signal(0);
  margenUtilidadBrutaAnimado = signal(0);
  tasaRotacionInventarioAnimado = signal(0);
  indiceQuiebreStockAnimado = signal(0);
  diasInventarioAnimado = signal(0);
  tasaRetencionClientesAnimado = signal(0);
  tasaConversionCotizacionesAnimado = signal(0);
  indiceVentasCruzadasAnimado = signal(0);
  diasCuentasPorPagarAnimado = signal(0);
  retornoInversionInventarioAnimado = signal(0);
  descuentoPromedioOtorgadoAnimado = signal(0);
  costoAterrizadoAnimado = signal(0);

  readonly jobLabels: Record<ScheduledJobName, string> = {
    operational_alerts: 'Generación de alertas',
    dashboard_freshness: 'Revisión de frescura',
    crm_reports: 'Reportes comerciales',
    document_mail: 'Envío de documentos por correo',
    fiscal_followup: 'Seguimiento de cancelaciones fiscales',
    campaign_simulation: 'Simulación de campañas',
    outputs_health: 'Salud de las salidas',
  };
  readonly healthLabels: Record<OutputsHealthLevel, string> = { ok: 'Sin pendientes', atencion: 'Requiere revisión', critico: 'Requiere acción' };
  readonly loadError = signal(false);
  readonly refreshStatus = toSignal(timer(0, 60000).pipe(
    switchMap(() => this.dashboardService.getRefreshStatus().pipe(catchError(() => of(null)))),
  ));
  // O01.3a · Se revisa cada 5 minutos; los avisos internos los genera el proceso outputs_health.
  readonly outputsHealth = toSignal(timer(0, 300000).pipe(
    switchMap(() => this.dashboardService.getOutputsHealth().pipe(
      map((health) => (health && Array.isArray(health.areas) && health.metricas ? health : null)),
      catchError(() => of(null)),
    )),
  ));
  readonly scheduledJobs = toSignal(timer(0, 60000).pipe(
    switchMap(() => this.dashboardService.getScheduledJobs().pipe(catchError(() => of(null)))),
  ));

  dashboardData = toSignal(
    forkJoin({
      metrics: this.dashboardService.getMetrics(),
      ventas: this.dashboardService.getVentas().pipe(map((res) => res[0])),
      inventario: this.dashboardService.getInventario().pipe(map((res) => res[0])),
      clientes: this.dashboardService.getClientes().pipe(map((res) => res[0])),
      operaciones: this.dashboardService.getOperaciones().pipe(map((res) => res[0])),
      crm: this.crmService.getResumen().pipe(catchError(() => of(null))),
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
      catchError(() => { this.loadError.set(true); return of(undefined); }),
    ),
  );

  displayedColumns = ['codigo', 'descripcion', 'dias_sin_ventas', 'existencia'];
  agingColumns = ['rango', 'monto'];
  alertaColumns = ['codigo', 'descripcion', 'existencia'];

  constructor() {
    effect(() => {
      this.navigation();
      const panel = this.automaticProcesses();
      if (panel && this.route.snapshot.queryParamMap.get('procesos') === '1') panel.nativeElement.open = true;
      const outputs = this.outputsPanel();
      if (outputs && this.route.snapshot.queryParamMap.get('salidas') === '1') outputs.nativeElement.open = true;
    });
    effect(() => {
      const data = this.dashboardData();
      if (data) {
        this.animateValue(Number(data.metrics?.ventasHoy) || 0, this.ventasHoyAnimado);
        this.animateValue(Number(data.metrics?.porCobrar) || 0, this.porCobrarAnimado);
        this.animateValue(Number(data.metrics?.porPagar) || 0, this.porPagarAnimado);
        this.animateValue(Number(data.metrics?.conteoBajos) || 0, this.conteoBajosAnimado);
        this.animateValue(Number(data.ventas?.ingresos_netos) || 0, this.ingresosNetosAnimado);
        this.animateValue(Number(data.ventas?.ticket_promedio) || 0, this.ticketPromedioAnimado);
        this.animateValue(Number(data.inventario?.valor_total_inventario) || 0, this.valorInventarioAnimado);
        this.animateValue(Number(data.operaciones?.tasa_cumplimiento) || 0, this.tasaCumplimientoAnimado);
        this.animateValue(Number(data.clientes?.valor_tiempo_vida) || 0, this.valorTiempoVidaAnimado);
        this.animateValue(Number(data.ventas?.margen_utilidad_bruta) || 0, this.margenUtilidadBrutaAnimado);
        this.animateValue(Number(data.inventario?.tasa_rotacion_inventario) || 0, this.tasaRotacionInventarioAnimado);
        this.animateValue(Number(data.inventario?.indice_quiebre_stock) || 0, this.indiceQuiebreStockAnimado);
        this.animateValue(Number(data.inventario?.dias_inventario) || 0, this.diasInventarioAnimado);
        this.animateValue(Number(data.clientes?.tasa_retencion_clientes) || 0, this.tasaRetencionClientesAnimado);
        this.animateValue(Number(data.operaciones?.tasa_conversion_cotizaciones) || 0, this.tasaConversionCotizacionesAnimado);
        this.animateValue(Number(data.operaciones?.indice_ventas_cruzadas) || 0, this.indiceVentasCruzadasAnimado);
        this.animateValue(Number(data.clientes?.dias_cuentas_por_pagar) || 0, this.diasCuentasPorPagarAnimado);
        this.animateValue(Number(data.inventario?.retorno_inversion_inventario) || 0, this.retornoInversionInventarioAnimado);
        this.animateValue(Number(data.ventas?.descuento_promedio_otorgado) || 0, this.descuentoPromedioOtorgadoAnimado);
        this.animateValue(Number(data.inventario?.costo_aterrizado) || 0, this.costoAterrizadoAnimado);
      }
    });
  }

  private animateValue(targetValue: number, sig: WritableSignal<number>) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { sig.set(targetValue); return; }
    const obj = { val: 0 };
    anime({
      targets: obj,
      val: targetValue,
      duration: 1500,
      easing: 'easeOutExpo',
      update: () => sig.set(obj.val)
    });
  }

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
          areaStyle: { opacity: 0.14, color: 'var(--c-chart-1)' },
          itemStyle: { color: 'var(--c-chart-1)' },
          lineStyle: { color: 'var(--c-chart-1)', width: 2.5 },
          smooth: true,
        },
      ],
    };
  }

  private buildFlujoDineroChart(porCobrar: number, porPagar: number): EChartsOption {
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: { type: 'category', data: ['Por cobrar', 'Por pagar'] },
      yAxis: { type: 'value' },
      series: [
        {
          name: 'Flujo',
          type: 'bar',
          data: [
            { value: porCobrar, itemStyle: { color: 'var(--c-chart-3)', borderRadius: [6, 6, 0, 0] } },
            { value: porPagar, itemStyle: { color: 'var(--c-chart-5)', borderRadius: [6, 6, 0, 0] } },
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
          itemStyle: { color: 'var(--c-chart-2)', borderRadius: [0, 6, 6, 0] },
        },
      ],
    };
  }

  private buildVentasPorCategoriaChart(ventasPorCategoria: CategoriaVenta[]): EChartsOption {
    const data = [...ventasPorCategoria].sort((a, b) => Number(b.ventas) - Number(a.ventas));
    // Top 10 AND Bottom 10 as per requirement
    const top10 = data.slice(0, 5);
    const bottom10 = data.slice(-5).reverse();
    const combined = data.length <= 10 ? data : [...top10, ...bottom10];

    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: { type: 'value' },
      yAxis: { type: 'category', data: combined.map((d) => d.categoria).reverse() },
      series: [
        {
          name: 'Ventas',
          type: 'bar',
          data: combined
            .map((d, index) => ({
              value: d.ventas,
              itemStyle: { color: data.length > 10 && index >= 5 ? 'var(--c-chart-6)' : 'var(--c-chart-1)' },
            }))
            .reverse(),
          // Con más de 10 categorías se muestran las 5 mayores (latón) y las 5 menores (pizarra).
          colorBy: 'data',
          itemStyle: { borderRadius: [0, 6, 6, 0] },
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
      grid: { top: 8, left: 8, right: 12, bottom: 64, containLabel: true },
      xAxis: { type: 'category', data: hours, splitArea: { show: false } },
      yAxis: { type: 'category', data: days, splitArea: { show: false } },
      visualMap: {
        min: 0,
        max: Math.max(...data.map((d) => d[2] as number), 100),
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        itemHeight: 160,
        inRange: { color: ['var(--c-brass-soft)', 'var(--c-chart-1)'] },
      },
      series: [
        {
          name: 'Ventas ($)',
          type: 'heatmap',
          data: data,
          label: { show: false },
          emphasis: {
            itemStyle: { borderColor: 'var(--c-text)', borderWidth: 1 },
          },
        },
      ],
    };
  }

  private buildRentabilidadChart(rentabilidad: RentabilidadProveedor[]): EChartsOption {
    const data = rentabilidad.filter(r => r.rentabilidad != null).map((r) => ({
      name: r.marca || r.proveedor || 'Desconocido',
      value: Number(r.rentabilidad),
    }));

    return {
      tooltip: { trigger: 'axis' },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: { type: 'value' },
      yAxis: { type: 'category', data: data.map(item => item.name) },
      series: [
        {
          name: 'Rentabilidad',
          type: 'bar',
          data: data.map(item => item.value),
          itemStyle: { color: 'var(--c-chart-3)', borderRadius: [0, 6, 6, 0] },
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
          itemStyle: { color: 'var(--c-chart-5)' },
        },
      ],
    };
  }
}
