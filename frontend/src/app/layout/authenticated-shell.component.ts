import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { AsyncPipe } from '@angular/common';
import { Component, inject, DestroyRef, ElementRef, HostListener, signal, ViewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenavModule, MatSidenav } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { catchError, debounceTime, distinctUntilChanged, filter, interval, map, of, shareReplay, startWith, switchMap, tap } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { SessionIdentity } from '../auth/auth.interface';
import { ThemeService } from '../services/theme.service';
import { CrmService, GlobalSearchItem, GlobalSearchResult } from '../services/crm.service';
import { AppNotification, NotificationService } from '../services/notification.service';
import { APP_PAGES, AppPage, pageAllowed, pageForPath, searchPages, sectionForPath } from './app-pages';

const RECENT_PAGES_KEY = 'erp.recent-pages';

@Component({
  selector: 'app-authenticated-shell',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatIconModule,
    MatButtonModule,
    MatSidenavModule,
    AsyncPipe,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './authenticated-shell.component.html',
  styleUrl: './authenticated-shell.component.css',
})
export class AuthenticatedShellComponent {
  private readonly breakpointObserver = inject(BreakpointObserver);
  readonly themeService = inject(ThemeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly crm = inject(CrmService);
  private readonly notificationsApi = inject(NotificationService);
  @ViewChild('sidenav') sidenav?: MatSidenav;
  @ViewChild('globalSearchInput') globalSearchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('globalSearchForm') globalSearchForm?: ElementRef<HTMLFormElement>;
  private readonly childRoutes = inject(ActivatedRoute).routeConfig?.children ?? [];

  user: SessionIdentity | null = null;
  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly searchResults = signal<GlobalSearchResult | null>(null);
  readonly searching = signal(false);
  readonly searchOpen = signal(false);
  /** U02.1 · Pantallas que coinciden con lo escrito y recientes (sólo las que el rol puede abrir). */
  readonly screenMatches = signal<AppPage[]>([]);
  readonly recentPages = signal<AppPage[]>([]);
  readonly searchTerm = signal('');
  readonly notificationsOpen = signal(false);
  readonly notifications = signal<AppNotification[]>([]);
  readonly unreadNotifications = signal(0);
  readonly currentPage = signal({ section: 'Inicio', title: 'Inicio', description: 'Resumen operativo' });
  readonly isHandset$ = this.breakpointObserver.observe(Breakpoints.Handset).pipe(
    map((result) => result.matches),
    shareReplay({bufferSize: 1, refCount: true}),
  );

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
  ) {
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.user = this.authService.getSessionIdentity();
      this.currentPage.set(this.pageForUrl(this.router.url));
      this.rememberPage(this.router.url);
      if (this.sidenav?.mode === 'over') this.sidenav.close();
    });
    this.user = this.authService.getSessionIdentity();
    this.currentPage.set(this.pageForUrl(this.router.url));
    this.rememberPage(this.router.url);
    this.searchControl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(value => {
      const term = value.trim();
      this.searchTerm.set(term);
      this.screenMatches.set(searchPages(term, this.allowedPages()));
      if (term) this.searchOpen.set(true);
    });
    this.searchControl.valueChanges.pipe(
      map(value => value.trim()), debounceTime(250), distinctUntilChanged(),
      tap(value => { if (value.length < 2) this.searchResults.set(null); }),
      filter(value => value.length >= 2), tap(() => this.searching.set(true)),
      switchMap(value => this.crm.buscarGlobal(value).pipe(catchError(() => of({ productos: [], clientes: [], unidades: [] })))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(result => { this.searchResults.set(result); this.searching.set(false); });
    interval(60000).pipe(startWith(0),switchMap(()=>this.notificationsApi.list().pipe(catchError(()=>of({unread:0,items:[]})))),takeUntilDestroyed(this.destroyRef))
      .subscribe(result=>{this.unreadNotifications.set(result.unread);this.notifications.set(result.items)});
  }

  toggleNotifications(){this.notificationsOpen.update(open=>!open);}
  openNotification(item:AppNotification){
    const complete=()=>{this.notifications.update(items=>items.map(value=>value.idNotification===item.idNotification?{...value,readAt:new Date().toISOString()}:value));this.unreadNotifications.update(value=>Math.max(0,value-(item.readAt?0:1)));this.notificationsOpen.set(false);if(item.route)this.router.navigateByUrl(item.route)};
    if(item.readAt)complete();else this.notificationsApi.read(item.idNotification).subscribe({next:complete,error:complete});
  }
  readAllNotifications(){this.notificationsApi.readAll().subscribe(()=>{this.unreadNotifications.set(0);this.notifications.update(items=>items.map(item=>({...item,readAt:item.readAt||new Date().toISOString()})))})}

  selectResult(kind: 'producto' | 'cliente' | 'unidad', item: GlobalSearchItem) {
    const q = item.codigo || item.titulo;
    const target = kind === 'producto' ? '/producto' : kind === 'cliente' ? '/cliente' : '/crm';
    this.router.navigate([target], { queryParams: { q } });
    this.searchOpen.set(false);
    this.searchControl.setValue('');
  }

  submitSearch() {
    const q = this.searchControl.value.trim();
    if (q.length < 2) return;
    this.router.navigate(['/producto'], { queryParams: { q } });
    this.searchOpen.set(false);
  }

  /** Abre el panel al enfocar: recientes con el campo vacío, coincidencias si ya hay texto. */
  openSearch() {
    this.recentPages.set(this.readRecent());
    this.searchOpen.set(this.searchTerm().length > 0 || this.recentPages().length > 0);
  }

  /** Cierra sólo si el foco salió de todo el buscador (las flechas mueven el foco a los resultados). */
  closeSearchSoon() {
    window.setTimeout(() => {
      if (!this.globalSearchForm?.nativeElement.contains(document.activeElement)) this.searchOpen.set(false);
    }, 160);
  }

  goToPage(page: AppPage) {
    this.router.navigateByUrl(page.route);
    this.searchOpen.set(false);
    this.searchControl.setValue('');
  }

  /** Flechas arriba/abajo recorren los resultados; Escape cierra y regresa al campo. */
  searchKeydown(event: KeyboardEvent) {
    const form = this.globalSearchForm?.nativeElement;
    if (!form) return;
    const options = Array.from(form.querySelectorAll<HTMLButtonElement>('.search-results button'));
    if (event.key === 'Escape') {
      this.searchOpen.set(false);
      this.globalSearchInput?.nativeElement.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (!this.searchOpen()) this.openSearch();
    if (!options.length) return;
    event.preventDefault();
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowUp' && index <= 0) { this.globalSearchInput?.nativeElement.focus(); return; }
    const next = event.key === 'ArrowDown' ? Math.min(options.length - 1, index + 1) : index - 1;
    options[next]?.focus();
  }

  pageSection(page: AppPage) { return sectionForPath(page.route); }

  private allowedPages() { return APP_PAGES.filter(page => pageAllowed(page, this.user?.role, this.childRoutes)); }

  private readRecent(): AppPage[] {
    try {
      const routes = JSON.parse(localStorage.getItem(RECENT_PAGES_KEY) || '[]') as unknown;
      const allowed = this.allowedPages();
      return Array.isArray(routes) ? routes.map(r => allowed.find(p => p.route === r)).filter((p): p is AppPage => !!p).slice(0, 5) : [];
    } catch { return []; }
  }

  /** Recientes por navegador (conveniencia local); si el almacenamiento no está disponible, simplemente no se muestran. */
  private rememberPage(url: string) {
    const page = pageForPath(url.split('?')[0]);
    if (!page) return;
    try {
      const previous = JSON.parse(localStorage.getItem(RECENT_PAGES_KEY) || '[]') as unknown;
      const list = Array.isArray(previous) ? previous.filter((r): r is string => typeof r === 'string' && r !== page.route) : [];
      localStorage.setItem(RECENT_PAGES_KEY, JSON.stringify([page.route, ...list].slice(0, 8)));
    } catch { /* sin almacenamiento local */ }
  }

  @HostListener('document:keydown', ['$event'])
  focusGlobalSearch(event: KeyboardEvent) {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
    event.preventDefault();
    this.globalSearchInput?.nativeElement.focus();
  }

  groupOpen(prefixes: string[]) { return prefixes.some(prefix => this.router.url.startsWith(prefix)); }

  private pageForUrl(url: string) {
    const path = url.split('?')[0];
    const match = pageForPath(path);
    const section = sectionForPath(path);
    return match ? { section, title: match.title, description: match.description } : { section, title: 'Refacciones y Tractorepuestos Tampico', description: 'Sistema ERP + CRM' };
  }

  initials(): string {
    const name = (this.user?.sub || 'Usuario').replace(/[_.-]+/g, ' ').trim();
    const parts = name.split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] ?? 'U') + (parts.length > 1 ? parts[1][0] : parts[0]?.[1] ?? '')).toUpperCase();
  }

  logout(): void {
    this.authService.logout();
    this.user = null;
    this.router.navigate(['/login']);
  }

}
