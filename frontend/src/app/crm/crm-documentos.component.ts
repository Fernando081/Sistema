import { CommonModule } from '@angular/common';
import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { timeout } from 'rxjs';
import { environment } from '../../environments/environment';
import { LOCAL_ERROR_FEEDBACK } from '../shared/http-error-context';

interface Quote { idCotizacion: number; folio: number; fechaEmision: string; estatus: string }
interface CommercialState {
  opportunity: { idOportunidad: number; idCliente: number | null; version: number; cliente: string | null };
  quotes: (Quote & { linkedAt: string; documentosVenta: number; cancelados: number; inconsistentes: number })[];
  truncated: boolean;
}
interface Customer { IdCliente: number; RazonSocial: string; RFC: string }
interface CommercialIntent { kind: 'cliente' | 'vincular' | 'retirar'; target: number; oportunidadId: number; expectedVersion: number; confirmado: true }

@Component({ selector: 'app-crm-documentos', standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, RouterLink],
  templateUrl: './crm-documentos.component.html', styleUrl: './crm-documentos.component.css' })
export class CrmDocumentosComponent {
  readonly oportunidadId = input.required<number>();
  readonly version = input.required<number>();
  readonly locked = input(false);
  readonly changed = output<void>();
  readonly working = output<boolean>();
  readonly reload = output<void>();
  private readonly http = inject(HttpClient);
  private readonly destroy = inject(DestroyRef);
  private get api() { return `${environment.apiBaseUrl}/crm/oportunidades/${this.oportunidadId()}/documentos-comerciales`; }
  private get options() { return { context: new HttpContext().set(LOCAL_ERROR_FEEDBACK, true) }; }
  readonly data = signal<CommercialState | null>(null);
  readonly loading = signal(false);
  readonly searching = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly term = signal('');
  readonly customerTerm = signal('');
  readonly customers = signal<Customer[]>([]);
  readonly candidates = signal<Quote[]>([]);
  readonly selected = signal(0);
  readonly selectedCustomer = signal(0);
  readonly confirmed = signal(false);
  readonly clientConfirmed = signal(false);
  readonly removeTarget = signal(0);
  readonly removeConfirmed = signal(false);
  readonly intent = signal<CommercialIntent | null>(null);

  opened(event: Event) {
    const details = event.target;
    if (details instanceof HTMLDetailsElement && details.open && !this.data()) this.load();
  }
  stale() { return !!this.data() && this.data()!.opportunity.version !== this.version(); }
  load() {
    if (this.loading() || this.saving()) return;
    this.loading.set(true); this.error.set(''); this.data.set(null);
    this.candidates.set([]); this.selected.set(0); this.confirmed.set(false);
    this.http.get<CommercialState>(this.api, this.options).pipe(timeout(10000), takeUntilDestroyed(this.destroy)).subscribe({
      next: data => { this.data.set(data); this.loading.set(false); },
      error: () => { this.loading.set(false); this.error.set('No se pudieron cargar los vínculos. Puede faltar acceso; vuelve a consultar.'); },
    });
  }
  search(kind: 'cliente' | 'cotizacion') {
    if (this.searching() || this.loading() || this.saving() || this.intent()) return;
    const term = (kind === 'cliente' ? this.customerTerm() : this.term()).trim();
    if (kind === 'cliente' && term.length < 2) { this.error.set('Escribe al menos dos caracteres para buscar un cliente.'); return; }
    this.searching.set(true); this.error.set('');
    if (kind === 'cliente') {
      this.customers.set([]); this.selectedCustomer.set(0); this.clientConfirmed.set(false);
      this.http.get<{ data: Customer[] }>(`${environment.apiBaseUrl}/cliente/pagina`, {
        ...this.options, params: { page: 1, limit: 20, term, sortBy: 'razonSocial', sortOrder: 'asc' },
      }).pipe(timeout(10000), takeUntilDestroyed(this.destroy)).subscribe({
        next: result => { this.customers.set(result.data); this.searching.set(false);
          if (!result.data.length) this.error.set('No hay clientes que coincidan. Prueba otro nombre o RFC.'); },
        error: () => { this.searching.set(false); this.error.set('No se pudo buscar el cliente. Conservamos el texto para reintentar.'); },
      });
    } else {
      this.candidates.set([]); this.selected.set(0); this.confirmed.set(false);
      this.http.get<Quote[]>(this.api + '/disponibles', { ...this.options, params: { term } })
        .pipe(timeout(10000), takeUntilDestroyed(this.destroy)).subscribe({
          next: rows => { this.candidates.set(rows); this.searching.set(false);
            if (!rows.length) this.error.set('No hay cotizaciones disponibles de este cliente. Revisa el folio o crea una cotización para él.'); },
          error: () => { this.searching.set(false); this.error.set('No se pudieron buscar cotizaciones. Conservamos el folio para reintentar.'); },
        });
    }
  }
  operate(kind: CommercialIntent['kind'], target: number, confirmed: boolean) {
    if (this.locked() || this.stale() || this.saving() || this.loading() || this.searching() || this.intent() || !confirmed || !target) return;
    this.intent.set({ kind, target, oportunidadId: this.oportunidadId(), expectedVersion: this.data()!.opportunity.version, confirmado: true });
    this.retry();
  }
  retry() {
    const intent = this.intent();
    if (!intent || this.saving() || this.loading() || this.locked()) return;
    this.saving.set(true); this.working.emit(true); this.error.set(''); this.notice.set('');
    const suffix = intent.kind === 'cliente' ? '/cliente' : `/cotizaciones/${intent.target}${intent.kind === 'retirar' ? '/retirar' : ''}`;
    const body = { expectedVersion: intent.expectedVersion, confirmado: true,
      ...(intent.kind === 'cliente' ? { idCliente: intent.target } : {}) };
    const api = `${environment.apiBaseUrl}/crm/oportunidades/${intent.oportunidadId}/documentos-comerciales`;
    this.http.put<{ version: number }>(api + suffix, body, this.options)
      .pipe(timeout(10000), takeUntilDestroyed(this.destroy)).subscribe({
        next: () => { this.saving.set(false); this.intent.set(null); this.working.emit(false);
          this.notice.set('Relación actualizada. El historial conserva la operación; no se modificaron documentos de venta.');
          this.confirmed.set(false); this.clientConfirmed.set(false); this.removeConfirmed.set(false); this.removeTarget.set(0);
          this.changed.emit(); this.load(); },
        error: (error: unknown) => {
          this.saving.set(false); this.working.emit(false);
          if (error instanceof HttpErrorResponse && [400, 403, 404, 409].includes(error.status)) {
            this.intent.set(null);
            this.error.set('No se aplicó con estos datos. Revisa cliente, origen y acceso; recarga la oportunidad completa antes de decidir otra vez.');
          } else this.error.set('No se pudo confirmar el resultado. Reintenta la misma operación antes de cambiar la selección.');
        },
      });
  }
}
