import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatTableDataSource } from '@angular/material/table';
import { PageEvent } from '@angular/material/paginator';
import { Sort } from '@angular/material/sort';
import { BehaviorSubject, EMPTY, Observable, Subject, Subscription, catchError, debounceTime, distinctUntilChanged, map, switchMap } from 'rxjs';
import { downloadDocument } from './document-download';
import { ActivatedRoute, Router } from '@angular/router';

export interface DirectoryQuery {
  page: number; limit: number; term: string;
  sortBy: 'id' | 'rfc' | 'razonSocial' | 'codigoPostal' | 'folio' | 'fecha' | 'cliente' | 'total' | 'estatus' | 'receptor' | 'codigo' | 'descripcion' | 'categoriaNombre' | 'marca' | 'ubicacion' | 'precioUnitario' | 'existencia'; sortOrder: 'asc' | 'desc';
  tipo?: '' | 'I' | 'E';
  estado?: string;
  desde?: string; hasta?: string;
}
export function validDirectoryDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31') return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export interface DirectoryPage<T> { data: T[]; total: number; page: number; totalPages: number; }

/** Conserva un único estado y descarta respuestas anteriores al cambiar filtros. */
export class RemoteDirectory<T> {
  readonly dataSource = new MatTableDataSource<T>();
  readonly loading = signal(false);
  readonly exporting = signal(false);
  readonly total = signal(0);
  readonly term = signal('');
  private readonly state = new BehaviorSubject<DirectoryQuery>({ page: 1, limit: 10, term: '', sortBy: 'id', sortOrder: 'desc' });
  private states = ['Pendiente', 'Timbrada', 'Cancelada', 'Pagada'];
  private readonly search = new Subject<string>();
  private readonly subscriptions = new Subscription();

  constructor(private readonly fetch: (query: DirectoryQuery) => Observable<DirectoryPage<T>>,
    private readonly notice: (message: string) => void,
    private readonly sortableKeys: string[] = ['rfc', 'razonSocial', 'codigoPostal']) {
    this.subscriptions.add(this.search.pipe(debounceTime(300), distinctUntilChanged())
      .subscribe(term => {
        if (term !== this.state.value.term) this.state.next({ ...this.state.value, term, page: 1 });
      }));
  }

  start(): void {
    this.subscriptions.add(this.state.pipe(switchMap(query => {
      this.loading.set(true);
      return this.fetch(query).pipe(map(page => ({ page, query })), catchError(() => {
        this.loading.set(false);
        this.dataSource.data = []; this.total.set(0);
        this.notice('No se pudo cargar el directorio. Intenta de nuevo.');
        return EMPTY;
      }));
    })).subscribe(({ page, query }) => {
      const lastPage = Math.max(1, page.totalPages);
      if (!page.data.length && query.page > lastPage) {
        this.state.next({ ...query, page: lastPage }); return;
      }
      this.dataSource.data = page.data; this.total.set(page.total); this.loading.set(false);
    }));
  }
  query(): DirectoryQuery { return { ...this.state.value, term: this.term().trim() }; }
  /** Estado de navegación validado; conserva parámetros ajenos al listado. */
  connectUrl(route: ActivatedRoute, router: Router, withTipo = false, states: string[] = []): void {
    const withFilters = withTipo || states.length > 0;
    if (states.length) this.states = states;
    this.subscriptions.add(route.queryParamMap.subscribe(params => {
      const integer = (name: string, max: number, fallback: number) => {
        const raw = params.get(name) || '';
        const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
        return Number.isSafeInteger(value) && value >= 1 && value <= max ? value : fallback;
      };
      let desde = params.get('desde') || ''; let hasta = params.get('hasta') || '';
      if (!validDirectoryDate(desde)) desde = '';
      if (!validDirectoryDate(hasta)) hasta = '';
      if (desde && hasta && desde > hasta) { desde = ''; hasta = ''; }
      const sort = params.get('sort') || 'id';
      const query: DirectoryQuery = {
        page: integer('page', 100000, 1), limit: integer('limit', 100, 10),
        term: (params.get('q') || '').slice(0, 200).trim(),
        sortBy: this.sortableKeys.includes(sort) ? sort as DirectoryQuery['sortBy'] : 'id',
        sortOrder: params.get('order') === 'asc' ? 'asc' : 'desc',
        ...(withTipo ? { tipo: params.get('tipo') === 'I' ? 'I' as const : params.get('tipo') === 'E' ? 'E' as const : '' as const } : {}),
        ...(withFilters ? { desde, hasta, estado: this.states.includes(params.get('estado') || '') ? params.get('estado') || '' : '' } : {}),
      };
      this.term.set(query.term); this.search.next(query.term);
      if (JSON.stringify(query) !== JSON.stringify(this.state.value)) this.state.next(query);
    }));
    this.subscriptions.add(this.state.subscribe(query => {
      const target = router.createUrlTree([], { relativeTo: route, queryParamsHandling: 'merge', queryParams: {
        q: query.term || null, page: query.page === 1 ? null : query.page,
        limit: query.limit === 10 ? null : query.limit,
        sort: query.sortBy === 'id' ? null : query.sortBy,
        order: query.sortOrder === 'desc' ? null : query.sortOrder,
        ...(withTipo ? { tipo: query.tipo || null } : {}),
        ...(withFilters ? { estado: query.estado || null, desde: query.desde || null, hasta: query.hasta || null } : {}),
      } });
      if (target.toString() !== router.url) void router.navigateByUrl(target, { replaceUrl: true });
    }));
  }
  setDates(desde: string, hasta: string): void {
    if ((desde && !validDirectoryDate(desde)) || (hasta && !validDirectoryDate(hasta)) || (desde && hasta && desde > hasta)) {
      this.notice('Revisa las fechas: Desde debe ser anterior o igual a Hasta.'); return;
    }
    const term = this.term().trim(); this.search.next(term);
    this.state.next({ ...this.state.value, term, page: 1, desde, hasta });
  }
  setEstado(estado: string): void {
    const term = this.term().trim(); this.search.next(term);
    this.state.next({ ...this.state.value, term, page: 1, estado: this.states.includes(estado) ? estado : '' });
  }
  setTipo(tipo: string): void {
    const term = this.term().trim(); this.search.next(term);
    this.state.next({ ...this.state.value, term, page: 1, tipo: tipo === 'I' || tipo === 'E' ? tipo : '' });
  }
  setTerm(term: string, immediate = false): void {
    this.term.set(term);
    if (immediate) this.state.next({ ...this.state.value, term: term.trim(), page: 1 });
    this.search.next(term.trim());
  }
  page(event: PageEvent): void { this.state.next({ ...this.state.value, page: event.pageIndex + 1, limit: event.pageSize }); }
  sort(event: Sort): void {
    const key = this.sortableKeys.includes(event.active) ? event.active as DirectoryQuery['sortBy'] : 'id';
    this.state.next({ ...this.state.value, sortBy: key, sortOrder: event.direction === 'asc' ? 'asc' : 'desc', page: 1 });
  }
  reload(): void { this.state.next(this.state.value); }
  dispose(): void { this.subscriptions.unsubscribe(); this.state.complete(); this.search.complete(); }

  export(fetch: (query: DirectoryQuery) => Observable<Blob>, filename: string): void {
    if (this.exporting()) return;
    this.exporting.set(true);
    this.subscriptions.add(fetch(this.query()).subscribe({
      next: blob => { downloadDocument(blob, filename); this.exporting.set(false); },
      error: (error: unknown) => {
        this.exporting.set(false);
        const payload: unknown = error instanceof HttpErrorResponse ? error.error : null;
        const fallback = 'No se pudo exportar el directorio. Intenta de nuevo.';
        if (payload instanceof Blob) {
          void payload.text().then(text => {
            const body: unknown = JSON.parse(text);
            this.notice(body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' ? body.message : fallback);
          }).catch(() => this.notice(fallback));
        } else this.notice(fallback);
      },
    }));
  }
}
