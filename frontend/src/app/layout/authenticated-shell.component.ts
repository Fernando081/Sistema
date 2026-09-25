import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { AsyncPipe } from '@angular/common';
import { Component, inject, DestroyRef, ElementRef, HostListener, signal, ViewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule, MatSidenav } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { catchError, debounceTime, distinctUntilChanged, filter, interval, map, of, shareReplay, startWith, switchMap, tap } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { DecodedToken } from '../auth/auth.interface';
import { ThemeService } from '../services/theme.service';
import { CrmService, GlobalSearchItem, GlobalSearchResult } from '../services/crm.service';
import { AppNotification, NotificationService } from '../services/notification.service';

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
    MatListModule,
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

  user: DecodedToken | null = null;
  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly searchResults = signal<GlobalSearchResult | null>(null);
  readonly searching = signal(false);
  readonly searchOpen = signal(false);
  readonly notificationsOpen = signal(false);
  readonly notifications = signal<AppNotification[]>([]);
  readonly unreadNotifications = signal(0);
  readonly currentPage = signal({ title: 'Inicio', description: 'Resumen operativo' });
  readonly isHandset$ = this.breakpointObserver.observe(Breakpoints.Handset).pipe(
    map((result) => result.matches),
    shareReplay({bufferSize: 1, refCount: true}),
  );

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
  ) {
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.user = this.authService.getDecodedToken();
      this.currentPage.set(this.pageForUrl(this.router.url));
      if (this.sidenav?.mode === 'over') this.sidenav.close();
    });
    this.user = this.authService.getDecodedToken();
    this.currentPage.set(this.pageForUrl(this.router.url));
    this.searchControl.valueChanges.pipe(
      map(value => value.trim()), debounceTime(250), distinctUntilChanged(),
      tap(value => { this.searchOpen.set(value.length >= 2); if (value.length < 2) this.searchResults.set(null); }),
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
    item.readAt?complete():this.notificationsApi.read(item.idNotification).subscribe({next:complete,error:complete});
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

  closeSearchSoon() { window.setTimeout(() => this.searchOpen.set(false), 160); }

  @HostListener('document:keydown', ['$event'])
  focusGlobalSearch(event: KeyboardEvent) {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
    event.preventDefault();
    this.globalSearchInput?.nativeElement.focus();
  }

  groupOpen(prefixes: string[]) { return prefixes.some(prefix => this.router.url.startsWith(prefix)); }

  private pageForUrl(url: string) {
    const path = url.split('?')[0];
    const pages: Array<[string, string, string]> = [
      ['/dashboard', 'Centro de operación', 'Prioridades, ventas y salud del negocio'],
      ['/venta', 'Nueva venta', 'Mostrador, cliente y facturación'],
      ['/pedidos', 'Pedidos y backorders', 'Apartados, surtido y mercancía pendiente'],
      ['/comercial', 'Política comercial', 'Precios, márgenes, crédito y autorizaciones'],
      ['/cotizacion/nueva', 'Nueva cotización', 'Prepara una propuesta para tu cliente'],
      ['/cotizacion/historial', 'Cotizaciones', 'Seguimiento y conversión de propuestas'],
      ['/facturas/global', 'Factura global', 'Concentra las ventas de mostrador'],
      ['/facturas', 'Facturas', 'Historial, documentos y devoluciones'],
      ['/producto', 'Productos e inventario', 'Existencias, aplicaciones y números de parte'],
      ['/almacen', 'Almacén profesional', 'Ubicaciones, transferencias, conteos, lotes y series'],
      ['/operaciones/smart-restock', 'Reabastecimiento', 'Sugerencias basadas en demanda y existencias'],
      ['/abastecimiento', 'Abastecimiento', 'Solicitudes, órdenes y recepciones de mercancía'],
      ['/compra/historial', 'Compras', 'Historial de entradas de mercancía'],
      ['/compra', 'Nueva compra', 'Registra mercancía y costos'],
      ['/crm', 'Clientes y CRM', 'Oportunidades, agenda, unidades y demanda'],
      ['/cliente', 'Clientes', 'Información fiscal y comercial'],
      ['/proveedor', 'Proveedores', 'Condiciones y datos de compra'],
      ['/garantias', 'Garantías', 'Seguimiento de reclamaciones'],
      ['/cobranza', 'Cobranza', 'Pagos y complementos de recepción'],
      ['/cuentas-por-pagar', 'Cuentas por pagar', 'Compromisos con proveedores'],
      ['/caja', 'Caja', 'Apertura, movimientos y cierre'],
      ['/gastos', 'Saldos y gastos', 'Egresos y flujo operativo'],
      ['/contabilidad', 'Contabilidad', 'Pólizas, balanza y estados financieros'],
      ['/reportes/utilidad', 'Utilidad', 'Rentabilidad de ventas'],
      ['/reportes/auditoria', 'Auditoría', 'Trazabilidad de cambios'],
      ['/usuarios', 'Usuarios y acceso', 'Roles y sesiones'],
      ['/perfil', 'Mi cuenta', 'Seguridad y preferencias'],
    ];
    const match = pages.find(([route]) => path === route) || pages.find(([route]) => path.startsWith(route + '/'));
    return match ? { title: match[1], description: match[2] } : { title: 'Refacciones y Tractorepuestos Tampico', description: 'Sistema ERP + CRM' };
  }

  logout(): void {
    this.authService.logout();
    this.user = null;
    this.router.navigate(['/login']);
  }

}
