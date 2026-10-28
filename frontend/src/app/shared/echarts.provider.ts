import {
  AfterViewInit,
  Directive,
  ElementRef,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { BarChart, HeatmapChart, LineChart, PieChart } from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import type { EChartsCoreOption } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { ThemeService } from '../services/theme.service';

echarts.use([
  BarChart,
  HeatmapChart,
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

/** Lee un token de color del sistema visual (styles.css) en el tema activo. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * U01.3 · Sustituye cadenas `var(--c-…)` de las opciones por el valor del tema activo,
 * para que cada gráfica declare colores semánticos sin conocer el modo claro/oscuro.
 */
function resolveTokens<T>(value: T): T {
  if (typeof value === 'string') {
    const match = /^var\((--[\w-]+)\)$/.exec(value);
    return (match ? token(match[1]) || value : value) as T;
  }
  if (Array.isArray(value)) return value.map((item) => resolveTokens(item)) as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = resolveTokens(item);
    return out as T;
  }
  return value;
}

/** Tema de ECharts construido con los tokens del sistema visual del tema activo. */
function erpChartTheme(): object {
  const text = token('--c-text');
  const text2 = token('--c-text-2');
  const text3 = token('--c-text-3');
  const border = token('--c-border');
  const borderStrong = token('--c-border-strong');
  const surface = token('--c-surface');
  const surface2 = token('--c-surface-2');
  const axis = {
    axisLine: { lineStyle: { color: borderStrong } },
    axisTick: { lineStyle: { color: borderStrong } },
    axisLabel: { color: text3 },
    nameTextStyle: { color: text3 },
    splitLine: { lineStyle: { color: border } },
    splitArea: { areaStyle: { color: [surface, surface2] } },
  };
  return {
    color: [1, 2, 3, 4, 5, 6].map((n) => token(`--c-chart-${n}`)),
    backgroundColor: 'transparent',
    textStyle: { color: text2, fontFamily: getComputedStyle(document.body).fontFamily },
    legend: { textStyle: { color: text2 } },
    tooltip: {
      backgroundColor: surface,
      borderColor: border,
      textStyle: { color: text },
      extraCssText: 'border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);',
    },
    categoryAxis: axis,
    valueAxis: axis,
    visualMap: {
      textStyle: { color: text2 },
      inRange: { color: [surface2, token('--c-chart-1')] },
    },
    line: { symbol: 'circle', symbolSize: 6, lineStyle: { width: 2 } },
    label: { color: text2 },
  };
}

/** Adaptador ligero que mantiene ECharts desacoplado de las API internas de Angular. */
@Directive({ selector: '[echarts]', standalone: true })
export class ErpEchartsDirective implements AfterViewInit, OnChanges, OnDestroy {
  @Input() options: EChartsCoreOption | null | undefined;

  private chart?: ReturnType<typeof echarts.init>;
  private resizeObserver?: ResizeObserver;
  private viewReady = false;
  private readonly themeService = inject(ThemeService);

  constructor(
    private readonly element: ElementRef<HTMLElement>,
    private readonly zone: NgZone,
  ) {
    // Al cambiar claro/oscuro se recrea la gráfica con los tokens nuevos. Se espera un cuadro
    // porque la clase `dark` del documento se aplica en otro efecto.
    effect(() => {
      this.themeService.isDarkMode();
      untracked(() => {
        if (!this.viewReady) return;
        requestAnimationFrame(() => this.zone.runOutsideAngular(() => this.recreate()));
      });
    });
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.zone.runOutsideAngular(() => {
      this.createChart();
      this.resizeObserver = new ResizeObserver(() => this.chart?.resize());
      this.resizeObserver.observe(this.element.nativeElement);
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.viewReady) return;
    this.zone.runOutsideAngular(() => {
      if (changes['options'] && this.options) {
        this.chart?.setOption(resolveTokens(this.options), { notMerge: true });
      }
    });
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.chart?.dispose();
  }

  private recreate(): void {
    this.chart?.dispose();
    this.createChart();
  }

  private createChart(): void {
    this.chart = echarts.init(this.element.nativeElement, erpChartTheme(), { renderer: 'canvas' });
    if (this.options) this.chart.setOption(resolveTokens(this.options), { notMerge: true });
  }
}
