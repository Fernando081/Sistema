// frontend/src/app/app.routes.ts

import { Routes } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MAT_DATE_LOCALE } from '@angular/material/core';
import { authGuard } from './auth/auth.guard';

export const AUTHENTICATED_ROUTES: Routes = [
  {
    path: '',
    canActivate: [authGuard],
    canActivateChild: [authGuard],
    providers: [
      provideAnimationsAsync(),
      { provide: MAT_DATE_LOCALE, useValue: 'es-MX' },
    ],
    loadComponent: () =>
      import('./layout/authenticated-shell.component').then(
        (m) => m.AuthenticatedShellComponent,
      ),
    children: [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    data: { roles: ['admin'] },
    loadComponent: () =>
      import('./dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },
  {
    path: 'reportes/utilidad',
    canActivate: [authGuard],
    data: { roles: ['admin'] },
    loadComponent: () =>
      import('./reportes/utilidad/reportes-utilidad.component').then(
        (m) => m.ReportesUtilidadComponent,
      ),
  },
  {
    path: 'reportes/auditoria',
    canActivate: [authGuard],
    data: { roles: ['admin'] },
    loadComponent: () =>
      import('./reportes/auditoria/auditoria').then(
        (m) => m.Auditoria,
      ),
  },
  {
    path: 'crm',
    canActivate: [authGuard],
    loadComponent: () => import('./crm/crm-pipeline.component').then((m) => m.CrmPipelineComponent),
  },
  {
    path: 'garantias',
    canActivate: [authGuard],
    loadComponent: () => import('./garantia/garantia-list.component').then((m) => m.GarantiaListComponent),
  },
  {
    path: 'cliente/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./cliente/cliente-360/cliente-360.component').then((m) => m.Cliente360Component),
  },
  {
    path: 'cliente',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./cliente/cliente-list/cliente-list.component').then((m) => m.ClienteListComponent),
  },
  {
    path: 'proveedor',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./proveedor/proveedor-list/proveedor-list.component').then(
        (m) => m.ProveedorListComponent,
      ),
  },
  {
    path: 'producto',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./producto/producto-list/producto-list.component').then(
        (m) => m.ProductoListComponent,
      ),
  },
  {
    path: 'venta',
    canActivate: [authGuard],
    loadComponent: () => import('./venta/venta.component').then((m) => m.VentaComponent),
  },
  {
    path: 'comisiones',
    canActivate: [authGuard],
    data: { roles: ['admin'] },
    loadComponent: () => import('./venta/comisiones/comisiones.component').then((m) => m.ComisionesComponent),
  },
  {
    path: 'facturas',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./venta/factura-list/factura-list.component').then((m) => m.FacturaListComponent),
  },
  {
    path: 'facturas/global',
    canActivate: [authGuard],
    data: { roles: ['admin'] },
    loadComponent: () =>
      import('./venta/factura-global/factura-global.component').then((m) => m.FacturaGlobalComponent),
  },
  {
    path: 'almacen',
    canActivate: [authGuard],
    loadComponent: () => import('./almacen/almacen.component').then((m) => m.AlmacenComponent),
  },
  {
    path: 'comercial',
    canActivate: [authGuard],
    loadComponent: () => import('./comercial/comercial.component').then((m) => m.ComercialComponent),
  },
  {
    path: 'abastecimiento',
    canActivate: [authGuard],
    loadComponent: () => import('./abastecimiento/abastecimiento.component').then((m) => m.AbastecimientoComponent),
  },
  {
    path: 'compra',
    canActivate: [authGuard],
    loadComponent: () => import('./compra/compra.component').then((m) => m.CompraComponent),
  },
  {
    path: 'cotizacion/nueva',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./cotizacion/nueva-cotizacion/nueva-cotizacion.component').then(
        (m) => m.NuevaCotizacionComponent,
      ),
  },
  {
    path: 'cotizacion/historial',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./cotizacion/cotizacion-list/cotizacion-list.component').then(
        (m) => m.CotizacionListComponent,
      ),
  },
  {
    path: 'compra/historial',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./compra/compra-list/compra-list.component').then((m) => m.CompraListComponent),
  },
  {
    path: 'cobranza',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./rep/rep-create/rep-create.component').then((m) => m.RepCreateComponent),
  },
  {
    path: 'operaciones/smart-restock',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./operaciones/smart-restock/smart-restock.component').then((m) => m.SmartRestockComponent),
  },
  {
    path: 'gastos',
    canActivate: [authGuard],
    data: { roles: ['admin'] },
    loadComponent: () =>
      import('./finanzas/gastos/gastos.component').then((m) => m.GastosComponent),
  },
  {
    path: 'contabilidad',
    canActivate: [authGuard],
    data: { roles: ['admin'] },
    loadComponent: () =>
      import('./finanzas/contabilidad/contabilidad.component').then((m) => m.ContabilidadComponent),
  },
  {
    path: 'cuentas-por-pagar',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pago/cuentas-por-pagar/cuentas-por-pagar.component').then((m) => m.CuentasPorPagarComponent),
  },
  {
    path: 'pedidos',
    canActivate: [authGuard],
    loadComponent: () => import('./pedido/pedido-list.component').then((m) => m.PedidoListComponent),
  },
  { path: 'usuarios', canActivate: [authGuard], data: { roles: ['admin'] }, loadComponent: () => import('./auth/users/users.component').then(m => m.UsersComponent) },
  { path: 'perfil', canActivate: [authGuard], loadComponent: () => import('./auth/profile/profile.component').then(m => m.ProfileComponent) },
  { path: 'caja', canActivate: [authGuard], data: { roles: ['admin'] }, loadComponent: () => import('./caja/caja.component').then(m => m.CajaComponent) },
  { path: '**', redirectTo: 'dashboard' },
    ],
  },
];
