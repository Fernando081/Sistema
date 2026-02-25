// frontend/src/app/app.routes.ts

import { Routes } from '@angular/router';
import { authGuard } from './auth/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: 'login',
    loadComponent: () => import('./auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () => import('./dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },
  {
    path: 'cliente',
    canActivate: [authGuard],
    loadComponent: () => import('./cliente/cliente-list/cliente-list.component').then((m) => m.ClienteListComponent),
  },
  {
    path: 'proveedor',
    canActivate: [authGuard],
    loadComponent: () => import('./proveedor/proveedor-list/proveedor-list.component').then((m) => m.ProveedorListComponent),
  },
  {
    path: 'producto',
    canActivate: [authGuard],
    loadComponent: () => import('./producto/producto-list/producto-list.component').then((m) => m.ProductoListComponent),
  },
  {
    path: 'venta',
    canActivate: [authGuard],
    loadComponent: () => import('./venta/venta.component').then((m) => m.VentaComponent),
  },
  {
    path: 'facturas',
    canActivate: [authGuard],
    loadComponent: () => import('./venta/factura-list/factura-list.component').then((m) => m.FacturaListComponent),
  },
  {
    path: 'compra',
    canActivate: [authGuard],
    loadComponent: () => import('./compra/compra.component').then((m) => m.CompraComponent),
  },
  {
    path: 'cotizacion/nueva',
    canActivate: [authGuard],
    loadComponent: () => import('./cotizacion/nueva-cotizacion/nueva-cotizacion.component').then((m) => m.NuevaCotizacionComponent),
  },
  {
    path: 'cotizacion/historial',
    canActivate: [authGuard],
    loadComponent: () => import('./cotizacion/cotizacion-list/cotizacion-list.component').then((m) => m.CotizacionListComponent),
  },
  {
    path: 'compra/historial',
    canActivate: [authGuard],
    loadComponent: () => import('./compra/compra-list/compra-list.component').then((m) => m.CompraListComponent),
  },
  {
    path: 'cobranza',
    canActivate: [authGuard],
    loadComponent: () => import('./pago/cobranza/cobranza.component').then((m) => m.CobranzaComponent),
  },
  {
    path: 'cuentas-por-pagar',
    canActivate: [authGuard],
    loadComponent: () => import('./pago/cuentas-por-pagar/cuentas-por-pagar.component').then((m) => m.CuentasPorPagarComponent),
  },
];
