import {
  AfterViewInit,
  Directive,
  ElementRef,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  SimpleChanges,
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

/** Adaptador ligero que mantiene ECharts desacoplado de las API internas de Angular. */
@Directive({ selector: '[echarts]', standalone: true })
export class ErpEchartsDirective implements AfterViewInit, OnChanges, OnDestroy {
  @Input() options: EChartsCoreOption | null | undefined;
  @Input() theme: string | object | null = null;

  private chart?: ReturnType<typeof echarts.init>;
  private resizeObserver?: ResizeObserver;
  private viewReady = false;

  constructor(
    private readonly element: ElementRef<HTMLElement>,
    private readonly zone: NgZone,
  ) {}

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
      if (changes['theme'] && !changes['theme'].firstChange) {
        this.chart?.dispose();
        this.createChart();
        return;
      }
      if (changes['options'] && this.options) {
        this.chart?.setOption(this.options, { notMerge: true });
      }
    });
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.chart?.dispose();
  }

  private createChart(): void {
    this.chart = echarts.init(this.element.nativeElement, this.theme ?? undefined, {
      renderer: 'canvas',
    });
    if (this.options) this.chart.setOption(this.options, { notMerge: true });
  }
}
