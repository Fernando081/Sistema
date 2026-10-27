import { CommonModule } from '@angular/common';
import { HttpClient, HttpContext } from '@angular/common/http';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { timeout } from 'rxjs';
import { environment } from '../../environments/environment';
import { LOCAL_ERROR_FEEDBACK } from '../shared/http-error-context';

export interface WebMetricsReport {
  source: 'crm-local'; generatedAt: string;
  period: { desde: string; hasta: string; timezone: string; days: number };
  totals: { recibidas: number; pendientes: number; revisadasSinOportunidad: number; descartadas: number;
    oportunidades: number; abiertasCrm: number; ganadasCrm: number; perdidasCrm: number;
    vigentes: number; vencidas: number; purgadas: number;
    piezasVigentes: number; piezasSnapshot: number; sinPiezas: number };
  conversionPct: number | null;
  daily: { fecha: string; recibidas: number; oportunidades: number }[];
  references: { code: string; brand: string; solicitudes: number; cantidad: number }[];
  unmeasured: string[];
  commercial?: { cotizacionesVinculadas: number; solicitudesConCotizacion: number; solicitudesConVenta: number;
    documentosVentaVigentes: number; documentosCancelados: number; documentosInconsistentes: number };
  finance?: { currencies: { moneda: string; documentos: number;
    importeDocumentado: string | null; ventasNetasSinImpuestos: string | null;
    notasCredito: string | null; devoluciones: string | null; cobrosRegistrados: string | null; saldoRegistrado: string | null;
    documentosNetoDesconocido: number; documentosCobroDesconocido: number; documentosSaldoDesconocido: number;
    documentosSinPagos: number; documentosSaldoNoConciliado: number;
    cash?: { baseMonetaria: string; reembolsosEfectivo: string | null; saldoAFavorGenerado: string | null;
      cobrosNetosRegistrados: string | null; documentosConCobroNeto: number; documentosCobroNetoDesconocido: number;
      documentosReembolsoDesconocido: number; reembolsosSinGastoVinculado: number; gastosNoConciliados: number;
      documentosPagosNoConciliados: number; documentosMonedaNoComparable: number };
    profit?: { baseCosto: string; costoVentaNeto: string | null; utilidadBruta: string | null; margenBrutoPct: string | null;
      documentosConRentabilidad: number; documentosRentabilidadDesconocida: number; documentosSinCostoValido: number;
      documentosMonedaCostoNoComparable: number; documentosDetalleNoConciliado: number } }[];
    coverage: { documentosVinculados: number; documentosFinancieros: number; globalesExcluidas: number;
      monedaDesconocida: number; importesInconsistentes: number; notasCanceladasExcluidas: number;
      repsCanceladosExcluidos: number; pagosRepCompatibilidadOmitidos: number } };
}

function initialPeriod() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Mexico_City',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (name: string) => parts.find(value => value.type === name)!.value;
  const hasta = `${part('year')}-${part('month')}-${part('day')}`;
  const first = new Date(hasta + 'T00:00:00Z'); first.setUTCDate(first.getUTCDate() - 29);
  return { desde: first.toISOString().slice(0, 10), hasta };
}

@Component({
  selector: 'app-crm-web-metrics', standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule],
  templateUrl: './crm-web-metrics.component.html', styleUrl: './crm-web-metrics.component.css',
})
export class CrmWebMetricsComponent {
  private readonly http = inject(HttpClient);
  private readonly destroy = inject(DestroyRef);
  private readonly initial = initialPeriod();
  readonly desde = signal(this.initial.desde);
  readonly hasta = signal(this.initial.hasta);
  readonly report = signal<WebMetricsReport | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');

  // Preserve cents even when totals exceed the safe Number range.
  amount(value: string | null, currency: string) {
    const parts = typeof value === 'string' ? /^(-?)(\d+)\.(\d{2})$/.exec(value) : null;
    return parts ? `${parts[1]}${parts[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${parts[3]} ${currency}` : 'Por conciliar';
  }

  percentage(value: string | null, unknownDocuments: number) {
    if (value === null) return unknownDocuments ? 'Por conciliar' : 'Sin ventas netas positivas';
    const parts = typeof value === 'string' ? /^(-?)(\d+)\.(\d{2})$/.exec(value) : null;
    return parts ? `${parts[1]}${parts[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${parts[3]} %` : 'Por conciliar';
  }

  changePeriod(field: 'desde' | 'hasta', value: string) {
    if (this.loading()) return;
    this[field].set(value); this.report.set(null); this.error.set('');
  }

  load() {
    if (this.loading()) return;
    this.report.set(null); this.error.set('');
    const first = this.desde(), last = this.hasta();
    const day = (value: string) => {
      const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(value + 'T00:00:00Z') : NaN;
      return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
        && value >= '2000-01-01' && value <= '2099-12-31' ? parsed : NaN;
    };
    const days = (day(last) - day(first)) / 86400000 + 1;
    if (!Number.isInteger(days) || days < 1 || days > 366) {
      this.error.set('Elige fechas válidas, en orden, y un intervalo de hasta 366 días.'); return;
    }
    this.loading.set(true);
    this.http.get<WebMetricsReport>(`${environment.apiBaseUrl}/crm/solicitudes-web/metricas`, {
      params: { desde: first, hasta: last }, context: new HttpContext().set(LOCAL_ERROR_FEEDBACK, true),
    }).pipe(timeout(10000), takeUntilDestroyed(this.destroy)).subscribe({
      next: result => { this.report.set(result); this.loading.set(false); },
      error: () => { this.loading.set(false);
        this.error.set('No se pudo consultar la medición. Conservamos tus fechas; vuelve a consultar.'); },
    });
  }
}
